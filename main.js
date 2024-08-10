/** 
 * 
 * @author Amit P
 * @since 20181213
 * @lastedit 20220818 
 */

// Load global modules
const config = require('config');
const url = require('url');
const httpProxy = require('http-proxy');
const moment = require('moment');
const ShortUniqueId = require('short-unique-id');
const net = require('node:net');

// Set few configurations
const default_params = config.get('default');
const app_params = config.get('app');
const uid = new ShortUniqueId({ length: 10 });
const uid_num = new ShortUniqueId({ length: 4, dictionary: 'number' });
const env = process.env.NODE_ENV || default_params.ENV;
const _ip = env == "development" ? '127.0.0.1' : JSON.parse(require('fs').readFileSync('./config/node.json')).id;
const nodeId = _ip.replaceAll('.', '');
const instanceId = `INST${nodeId}${process.pid}`;
const appId = 'wsman';

// Load local modules
const { logger, loggerSetObject } = require('./include/logger');
loggerSetObject(instanceId, appId);
const { mysql, mysqlSetObject } = require('./services/mysql_calls');
mysqlSetObject(logger);
const { redis, redisSetObject } = require('./services/redis_calls');
redisSetObject(instanceId, appId, nodeId, logger);
const { _function, functionSetObject } = require('./include/functions');
functionSetObject(redis, logger);
const { app, appSetObject } = require('./routes/_app');
appSetObject(_ip, nodeId, redis, mysql, _function, logger);
const { hook, hookSetObject } = require('./include/hooks');
hookSetObject(redis, mysql, logger);

try {
    let _server = app.listen((process.env.PORT || app_params.wsman_port), async () => {
        logger.trace(`[-] ${default_params.application} server (instance) started in ${env} mode at http://${_server.address().address}:${_server.address().port} @${process.pid}`);
        logger.trace(`[-] Testing maria db...`);
        await hook.run();

        //if we get websocket request
        _server.on('upgrade', function (req, socket, head) {
            //update connection stats
            redis.incrementStatVal(`connections:WS:${_ip}`, (err, new_count) => {
                if (err)
                    logger.writeMany(`[-] Failed to increment connection count, err: ${err.message}`, null, null, ['error', 'trace']);
            });
            if (req.headers['user-agent']) {
                redis.incrementStatVal(`user-agent:WS:${req.headers['user-agent']}`, (err0, new_count) => {
                    if (err0)
                        logger.writeMany(`[${timestamp}] failed to get user-agent, err: ${err0.message}`, null, null, ['error', 'trace']);
                });
            }

            //start dancing
            let _url = url.parse(req.url, true);
            _url.path_array = _url.pathname.split('/').filter(n => n);

            //set timestamp
            req.timestamp = `${moment().unix()}${nodeId}${uid_num()}${process.pid}`;
            req.headers.etimestamp = req.timestamp;

            //set request ip
            //console.log(req.socket.remoteAddress, req.headers['x-forwarded-for']);
            //let req_ips = req.socket.remoteAddress || req.headers['x-forwarded-for'] || '0';
            let req_ips = req.headers['x-forwarded-for'] || '0';
            let ips = req_ips.split(':').filter(val => { if (net.isIP(val)) return val });
            
            req.headers._ip = ips.length != 0 ? ips[ips.length - 1] : '0';

            //set feed type prices or orders
            req.headers.feedtype = _url.path_array[1] || "NA";

            try {
                logger.trace(`[${req.timestamp}] New WebSocket request---/${req.headers.feedtype}`);
                logger.writeMany(`[${req.timestamp}] Request headers: ${JSON.stringify(req.headers)}, Request url: ${JSON.stringify(req.url)}`, null, null, ['info', 'trace']);
                //first check if request IP is OK to go
                redis.isIpWhitelisted(req, is_whitelisted => {
                    if (!is_whitelisted) {
                        faultCall(`Session Not Allowed - Unauthorized access`, `Request rejected as IP ${req.headers._ip} is not whitelisted.`, _url, req, socket, head);
                    } else {
                        redis.isIpBlacklisted(req, is_blacklisted => {
                            if (is_blacklisted) {
                                if (is_blacklisted == 100)
                                    faultCall(`Session Not Allowed - Unauthorized access`, null, _url, req, socket, head);
                                else
                                    faultCall(`Session Not Allowed - Unauthorized access`, `Request rejected for blacklisted IP ${req.headers._ip}`, _url, req, socket, head);
                            } else {
                                if (_url.query.EIO != app_params.EIO) {
                                    //engine.io version must be 4 (rare condition) 
                                    failedFS(req, socket, `Invalid Configuration - Wrong engine.io/socket.io version during handshake request. Expected value: ${app_params.EIO} Received value ${_url.query.EIO}`, `Invalid Configuration - Wrong engine.io/socket.io version during handshake request. Expected value: ${app_params.EIO}`);
                                } else if (_url.query.transport != app_params.transport) {
                                    //transport must be websocket (rare condition) 
                                    faultCall(`Invalid Configuration - Wrong transport used during handshake request. Expected value: ${app_params.transport}, ${app_params.feed_path}${app_params.market_feed_path}, ${app_params.feed_path}${app_params.order_feed_path}`, `Received value ${_url.query.transport}`, _url, req, socket, head, true);
                                } else if (_url.path_array[0] != app_params.feed_path.slice(1)) {
                                    //first path value must be /marketlive
                                    faultCall(`Invalid Configuration - Wrong server path used during handshake request. Expected value: ${app_params.feed_path}${app_params.market_feed_path}, ${app_params.feed_path}${app_params.order_feed_path}`, `Received value ${_url.path_array[1]}`, _url, req, socket, head, true);
                                } else if (_url.path_array.length == 1) {
                                    //faultCall(`Invalid Configuration - Wrong server path used during handshake request. Expected value: ${app_params.feed_path}${app_params.market_feed_path}, ${app_params.feed_path}${app_params.order_feed_path}`, `Received value ${_url.path_array[1]}`, _url, req, socket, head, true);
                                    //start test feed if no second path value provided
                                    req.url = `/fault0/${_url.search}`;
                                    logger.writeMany(`[${req.timestamp}] Connecting to test feed`, null, null, ['warning', 'trace']);
                                    randomProxy("FS", _url, req, socket, head);
                                } else if (![app_params.market_feed_path.slice(1), app_params.order_feed_path.slice(1)].includes(_url.path_array[1])) {
                                    //second path value must be either /prices or /orders
                                    faultCall(`Invalid Configuration - Wrong server path used during handshake request. Expected value: ${app_params.feed_path}${app_params.market_feed_path}, ${app_params.feed_path}${app_params.order_feed_path}`, `Received value ${_url.path_array[1]}`, _url, req, socket, head, true);
                                } else {
                                    //everything is ok, let's check access token
                                    _function.checkAccessToken(req, (token_data) => {
                                        //remove authorization part from headers (security and keep header length small)
                                        delete req.headers.authorization
                                        if (!token_data) {
                                            faultCall('Unauthorized Access - Access token invalid or unavailable.', "", _url, req, socket, head, true);
                                        } else {
                                            req.headers.tokenid = token_data.tokenid
                                            //lets make redis key (user master)
                                            let user_app_key = `${token_data.username}_${token_data.application}`;
                                            //lets fetch user master-------------------------------------------------------------master
                                            redis.getUserMaster(user_app_key, (err, user_master) => {
                                                if (err || !user_master) {
                                                    //error while getting master from redis
                                                    if (typeof err === "string") {
                                                        if (err == "MASTER_NOT_FOUND" || err == "MASTER_UPDATE" || err == "MASTER_INCOMPLETE") {
                                                            //expected errors-------------------------------------------------------------master
                                                            logger.writeMany(`[${req.timestamp}] ${err}, creating new...`, null, null, ['warning', 'trace']);
                                                            redis.saveUserMaster(user_app_key, token_data, mysql, req, (err0, result0) => {
                                                                //creting new master
                                                                let _token_data = JSON.stringify(token_data);
                                                                if (err0 || !result0) {
                                                                    //error while saving master in redis
                                                                    if (typeof err0 === "string") {
                                                                        //some expected errors
                                                                        errorCheck(err0, { user_app: user_app_key, token_data: _token_data }, _url, req, socket, head);
                                                                    } else {
                                                                        //unknown error
                                                                        faultCall('Internal Error - Failed to save user details', `Error: ${err0.message} [user_app: ${user_app_key}, token: ${_token_data}]`, _url, req, socket, head);
                                                                    }
                                                                } else {
                                                                    //master saved - let's connect-------------------------------------------------------------connection
                                                                    connectSocket(user_app_key, token_data, _url, req, socket, head);
                                                                }
                                                            });
                                                        } else {
                                                            //error while getting master from redis, error is string (unexpected error)
                                                            faultCall('Internal Error [2] - Failed to get user details', `Failed to get user master, error: ${err} [user_app: ${user_app_key}, result: ${user_master}]`, _url, req, socket, head);
                                                        }
                                                    } else {
                                                        //error while getting master from redis, unknown error
                                                        faultCall('Internal Error [3] - Failed to get user details', `Failed to get user master, error: ${err.message} [user_app: ${user_app_key}, result: ${user_master}]`, _url, req, socket, head);
                                                    }
                                                } else {
                                                    //matser found - user_master
                                                    //lets check if token exists in master
                                                    if (user_master[`token_stat_${token_data.tokenid}`] === undefined) {
                                                        //no token details, so let's add new token details------------------------------------------------------------master
                                                        redis.addTokenInMaster(user_app_key, token_data, mysql, req, (err6, result6) => {
                                                            let _token_data = JSON.stringify(token_data);
                                                            if (err6 || !result6) {
                                                                //error occured
                                                                if (typeof err6 === "string") {
                                                                    //some expected errors
                                                                    errorCheck(err6, { user_app: user_app_key, token_data: _token_data }, _url, req, socket, head);
                                                                } else {
                                                                    //unknown error
                                                                    faultCall('Internal Error - Failed to save user details', `Error: ${err6.message} [user_app: ${user_app_key}, token: ${_token_data}]`, _url, req, socket, head);
                                                                }
                                                            } else {
                                                                //token saved - let's connect-------------------------------------------------------------connection
                                                                connectSocket(user_app_key, token_data, _url, req, socket, head);
                                                            }
                                                        });
                                                    } else {
                                                        //token exists - lets connect-------------------------------------------------------------connection
                                                        connectSocket(user_app_key, token_data, _url, req, socket, head);
                                                    }
                                                }
                                            });
                                        }
                                    });
                                }
                            }
                        });
                    }
                });
            } catch (error0) {
                //unknown error
                faultCall("Internal Error [1] - Failed to connect websocket", `Process failed, error: ${error0.message}`, _url, req, socket, head);
                return;
            }
        });
    });
} catch (error) {
    //unknown error
    logger.writeMany(`[-] Failed to start server, error: ${error.message}`, null, null, ['error', 'trace']);
}

function connectSocket(user_app_key, token_data, _url, req, socket, head) {
    //fetch master for final------------------------------------------------------------master
    redis.getUserMaster(user_app_key, (err3, user_master) => {
        if (err3 || !user_master) {
            //error while getting master from redis (unexpected error)
            faultCall('Internal Error [1] - Failed to get user details', `Error: ${JSON.stringify(err3)} [user_app: ${user_app_key}, token: ${JSON.stringify(token_data)}]`, _url, req, socket, head);
        } else {
            //master found - user_master
            //can we allow this connection?------------------------------------------------------------session
            redis.canAllowSession(req, user_master, token_data.tokenid, (err4, result) => {
                //let _user_master = JSON.stringify(user_master);
                if (err4 || !result) {
                    if (typeof err4 === "string") {
                        //some expected errors
                        errorCheck(err4, { user_master: user_master.master_name, msg: result, tokenid: token_data.tokenid }, _url, req, socket, head);
                    } else {
                        //unknown error
                        faultCall('Internal Error - Failed to check session details', `Error: ${err4.message} [user_master: ${user_master.master_name}]`, _url, req, socket, head);
                    }
                } else {
                    //add session
                    logger.trace(`[${req.timestamp}] Adding session...`);
                    req.headers.userapp = user_master.master_name;
                    req.headers.uuid = uid();
                    req.headers.username = user_master.username;
                    req.headers.clientid = user_master.clientid;
                    req.headers.userrole = user_master.user_role || 0;
                    //Lets add new session------------------------------------------------------------session
                    redis.addSession(req, token_data.tokenid, (err, ready) => {
                        if (err) {
                            //unknown error
                            faultCall('Internal Error [1] - Failed to add session details', `Error: ${err.message} [user_master: ${user_master.master_name}, ${result}]`, _url, req, socket, head);
                        } else if (ready) {
                            //connect websocket
                            if (token_data.scope == app_params.market_feed_path.slice(1) && _url.path_array[1] == app_params.market_feed_path.slice(1)) {
                                //scope is market feed and path is market feed - OK----------------------------------success
                                randomProxy("MF", _url, req, socket, head, req.headers.userapp);
                            } else if (token_data.scope == app_params.order_feed_path.slice(1) && _url.path_array[1] == app_params.order_feed_path.slice(1)) {
                                //scope is order feed and path is order feed - OK----------------------------------success                         
                                randomProxy("OF", _url, req, socket, head, req.headers.userapp);
                            } else if (token_data.scope == 'all') {
                                //scope is all (any)
                                if (_url.path_array[1] == app_params.market_feed_path.slice(1)) {
                                    //path is market feed - OK---------------------------------------------------success
                                    randomProxy("MF", _url, req, socket, head, req.headers.userapp);
                                } else if (_url.path_array[1] == app_params.order_feed_path.slice(1)) {
                                    //path is order feed - OK----------------------------------------------success
                                    randomProxy("OF", _url, req, socket, head, req.headers.userapp);
                                } else {
                                    //path do not match - NOTOK
                                    faultCall(`Invalid Configuration - Wrong server path used during handshake request. Expected value: ${app_params.feed_path}${app_params.market_feed_path}, ${app_params.feed_path}${app_params.order_feed_path}`, `Path: ${_url.path_array[1]} Scope: ${token_data.scope} [user_master: ${user_master.master_name}, ${result}]`, _url, req, socket, head, true);
                                }
                            } else {
                                //path and scope does not match - NOTOK
                                faultCall(`Session Not Allowed - You do not have permission for this type of feed`, `Path: ${_url.path_array[1]} Scope: ${token_data.scope} [user_master: ${user_master.master_name}, ${result}]`, _url, req, socket, head, true);
                            }
                        } else {
                            //unknown error
                            faultCall('Internal Error [2] - Failed to add session details', `Error: Unknown [user_master: ${user_master.master_name}, ${result}]`, _url, req, socket, head);
                        }
                    });
                }
            });
        }
    });
}

function errorCheck(err, other, _url, req, socket, head) {
    let log_err = `Error: ${err} [`;
    log_err += other.user_app ? 'user_app: ' + other.user_app + ', ' : '';
    log_err += other.token_data ? 'token_data: ' + other.token_data + ', ' : '';
    log_err += other.msg ? other.msg + ', ' : '';
    log_err += other.user_master ? 'user_master: ' + other.user_master + ', ' : '';
    log_err += other.tokenid ? 'token_id: ' + other.tokenid + ', ' : '';
    log_err += ']';

    switch (err) {
        case "USER_NOT_FOUND":
        case "USER_INACTIVE":
            faultCall('Session Not Allowed - User account disabled or unavailable', log_err, _url, req, socket, head, true);
            break;
        case "TOKEN_NOT_FOUND":
        case "TOKEN_INACTIVE":
            faultCall('Session Not Allowed - Access Token is invalid or unavailable', log_err, _url, req, socket, head, true);
            break;
        case "APP_NOT_FOUND":
        case "APP_INACTIVE":
            faultCall('Session Not Allowed - User application disabled or unavailable', log_err, _url, req, socket, head, true);
            break;
        case "RATE_LIMIT":
            faultCall(`Session Not Allowed - You have reached total allowed connection count [${other.msg}]`, log_err, _url, req, socket, head, true);
            break;
        case "IP_NOT_WHITELISTED":
        case "IP_NOT_ALLOWED":
        case "IP_BLACKLISTED":
            faultCall(`Session Not Allowed - Unauthorized access`, log_err, _url, req, socket, head, true);
            break;
        case "FEED_NOT_AVAILABLE":
            logger.writeMany(`[${req.timestamp}] ${req.headers.feedtype} feed not available`, null, null, ['error', 'trace']);
            //faultCall(`All Feed Down - Currently cannot establish websocket connection`, log_err, _url, req, socket, head, true);
            break;
        default:
            faultCall('Internal Error [2] - Failed to connect websocket, Try again', log_err, _url, req, socket, head);
            break;
    }
}

function randomProxy(keyId, _url, req, socket, head, user_app = "NA") {
    try {
        redis.getAvailableFeed(keyId, (err, _target) => {
            if (err || !_target) {
                let log_msg = `All ${keyId} feeds are down, ${err.message || ''} [user_app: ${user_app}]`;
                if (keyId == "FS") {
                    failedFS(req, socket, log_msg);
                } else {
                    faultCall('Connection Not Available [1] - Failed to get any available feed', log_msg, _url, req, socket, head);
                }
            } else {
                let _proxy = new httpProxy.createProxyServer({ target: { "host": _target[1], "port": _target[2] } });
                if (keyId != "FS") {
                    logger.writeMany(`[${req.timestamp}] Connection details Feed: ${_target} sessionId: ${req.headers.uuid || '-'}`, null, null, ['info', 'trace']);
                    //redis.resetStatVal(`bottest:${req.headers._ip}`, (err, status) => {
                    //    if (err)
                    //        logger.writeMany(`[-] Failed to reset ip hit count, err: ${err.message}`, null, null, ['error', 'trace']);
                    //});
                }
                _proxy.ws(req, socket, head, e => {
                    if (e) {
                        let log_msg = `Failed to establish websocket at ${_target}, error: ${e.message}`;
                        if (keyId == "FS") {
                            failedFS(req, socket, log_msg);
                        } else {
                            faultCall('Connection Not Available [2] - Failed to get any available feed', log_msg, _url, req, socket, head);
                        }
                    }
                });
            }
        });
    } catch (error) {
        let log_msg = `All ${keyId} feeds are down, error: ${error.message}`;
        if (keyId == "FS") {
            failedFS(req, socket, log_msg);
        } else {
            faultCall('Connection Not Available [3] - Failed to get any available feed', log_msg, _url, req, socket, head);
        }
    }
}

function faultCall(client_msg, log_msg, _url, req, socket, head, bot_test, fault = 'faultn') {
    req.url = `/${fault}/${_url.search}`;
    req.headers.errormessage = client_msg;
    //write log only if log message present
    if (log_msg) {
        logger.writeMany(`[${req.timestamp}] ${client_msg}, ${log_msg}`, null, null, ['error', 'trace']);
        redis.addFault(client_msg, log_msg, req);
    }
    if (req.headers.uuid) {//if session was established
        logger.trace(`[${req.timestamp}] Removing session...`);
        redis.removeSession(req, client_msg, log_msg, (err, status) => {
            if (err) {
                logger.writeMany(`[${req.timestamp}] Error while removing live session, error: ${err.message} [user_app: ${req.headers.userapp}, sessionId: ${req.headers.uuid}]`, null, null, ['error', 'trace']);
            }
        });
    }
    randomProxy("FS", _url, req, socket, head);
    if (bot_test) {
        //update ip hit stats
        redis.incrementStatVal(`bottest:${req.headers._ip}`, (err, new_count) => {
            if (err)
                logger.writeMany(`[-] Failed to increment ip hit count, err: ${err.message}`, null, null, ['error', 'trace']);
        });
    }
}

//if fault streamer is not available
function failedFS(req, socket, log_msg = null, client_msg = 'Failed to get any available feed for websocket connection\r\n') {
    logger.writeMany(`[${req.timestamp}] ${log_msg}`, null, null, ['error', 'trace']);
    if (req.headers.uuid) {//if session was established
        logger.trace(`[${req.timestamp}] Removing session...`);
        redis.removeSession(req, null, log_msg, (err, status) => {
            if (err) {
                logger.writeMany(`[${req.timestamp}] Error while removing live session, error: ${err.message} [user_app: ${req.headers.userapp}, sessionId: ${req.headers.uuid}]`, null, null, ['error', 'trace']);
            }
        });
    }
    if (socket) {
        socket.write('HTTP/1.1 404 Not Found\r\n' +
            'Error: WebSocket Disconnected, timestamp-' + req.timestamp + '\r\n' +
            'Description: ' + client_msg + '\r\n' +
            '\r\n');
        socket.end();
        if (req) {
            logger.writeMany(`[${req.timestamp}] Socket disconnected.`, null, null, ['error', 'trace']);
        }
    }
    redis.addFault(client_msg, log_msg, req);
}
