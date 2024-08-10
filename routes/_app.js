const express = require('express');
const config = require('config');
const moment = require('moment');
const ShortUniqueId = require('short-unique-id');
const net = require('node:net');

const { check, checkSetObject } = require('../include/middlewear');
const { action, actionSetObject } = require('../services/actions');

const app = express();
const default_params = config.get('default');
const app_params = config.get('app');
const uid_num = new ShortUniqueId({ length: 4, dictionary: 'number' });
const router = express.Router();
const path = __dirname + '/views/';
let ip = null, nodeId = null, redis = null, __function = null, logger = null;

// general configuration for express app
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.all('/*', function (req, res, next) {
    try {

        //res.header("Access-Control-Allow-Origin", "https://amitofile.in");
        res.header("Access-Control-Allow-Origin", "*");
        res.header("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
        res.header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");

        if (!req.params[0].startsWith("marketlive/libs") && !req.params[0].startsWith("marketlive/imgs") && !req.params[0].startsWith("marketlive/fonts")) {
            req.timestamp = `${moment().unix()}${nodeId}${uid_num()}${process.pid}`;
            logger.writeMany(`[${req.timestamp}] --- New request--- ${JSON.stringify(req.params)}`, null, null, ['info', 'trace']);
            logger.writeMany(`[${req.timestamp}] Request headers: ${JSON.stringify(req.headers)}, Request body: ${JSON.stringify(req.body)}`, null, null, ['info', 'trace']);
        }

        if (default_params.DEBUG) logger.trace(`req.socket.remoteAddress ${req.socket.remoteAddress}, req.headers['x-forwarded-for'] ${req.headers['x-forwarded-for']}`);
        //let req_ips = req.socket.remoteAddress || req.headers['x-forwarded-for'] || '0';
        let req_ips = req.headers['x-forwarded-for'] || '0';
        let ips = req_ips.split(':').filter(val => { if (net.isIP(val)) return val });
            
        req.headers._ip = ips.length != 0 ? ips[ips.length - 1] : '0';
        if (default_params.DEBUG) logger.trace(`req.headers._ip ${req.headers._ip}`);

        redis.isIpWhitelisted(req, is_whitelisted => {
            if (!is_whitelisted) {
                res.header("Access-Control-Allow-Origin", "https://amitofile.in");
                res.header("Access-Control-Allow-Methods", "GET");
                res.header("Access-Control-Allow-Headers", "Content-Type, X-Requested-With");
                __function.setError(req, res, "Session Not Allowed - Unauthorized access", `Request rejected as IP ${req.headers._ip} is not whitelisted.`, null, 401);
            } else {
                redis.isIpBlacklisted(req, is_blacklisted => {
                    if (is_blacklisted) {
                        res.header("Access-Control-Allow-Origin", "https://amitofile.in");
                        res.header("Access-Control-Allow-Methods", "GET");
                        res.header("Access-Control-Allow-Headers", "Content-Type, X-Requested-With");
                        if (is_blacklisted == 100)
                            __function.setError(req, res, "Session Not Allowed - Unauthorized access", null, null, 401);
                        else
                            __function.setError(req, res, "Session Not Allowed - Unauthorized access", `Request rejected for blacklisted IP ${req.headers._ip}`, null, 401);
                    } else {
                        if (!req.params[0].startsWith("marketlive/libs") && !req.params[0].startsWith("marketlive/imgs") && !req.params[0].startsWith("marketlive/fonts")) {
                            if (req.params[0].startsWith("marketlive/auth")) {
                                redis.incrementStatVal(`connections:MAIN:AUTH:${ip}`, (err, new_count) => {
                                    if (err)
                                        logger.writeMany(`[-] Failed to increment connection count, err: ${err.message || err}`, null, null, ['error', 'trace']);
                                });
                                if (req.headers['user-agent']) {
                                    redis.incrementStatVal(`user-agent:MAIN:AUTH:${req.headers['user-agent']}`, (err0, new_count) => {
                                        if (err0)
                                            logger.writeMany(`[${req.timestamp}] failed to get user-agent, err: ${err0.message}`, null, null, ['error', 'trace']);
                                    });
                                }
                            } else {
                                redis.incrementStatVal(`connections:MAIN:WEB:${ip}`, (err, new_count) => {
                                    if (err)
                                        logger.writeMany(`[-] Failed to increment connection count, err: ${err.message || err}`, null, null, ['error', 'trace']);
                                });
                                if (req.headers['user-agent']) {
                                    redis.incrementStatVal(`user-agent:MAIN:WEB:${req.headers['user-agent']}`, (err0, new_count) => {
                                        if (err0)
                                            logger.writeMany(`[${req.timestamp}] failed to get user-agent, err: ${err0.message}`, null, null, ['error', 'trace']);
                                    });
                                }
                            }
                        }
                        next();
                    }
                });
            }
        });
    } catch (error) {
        __function.setError(req, res, "Operation failed", `Failed to process request, err: ${error.message}`, true);
    }
});
app.use('/marketlive/libs', express.static(path + 'libs'));
app.use('/marketlive/imgs', express.static(path + 'imgs'));
app.use('/marketlive/fonts', express.static(path + 'fonts'));
app.use('/', router);
app.disable('x-powered-by');
//-------------------------------------

//Empty request
router.get(app_params.feed_path, (req, res) => {
    try {
        res.sendFile(path + 'index.html');
    } catch (error) {
        __function.setError(req, res, "Operation failed", `Failed to process request, err: ${error.message}`, true);
    }
});

router.get(app_params.feed_path + app_params.market_feed_path, (req, res) => {
    __function.setResult(req, res, 'Websocket - Market Feed');
});

router.get(app_params.feed_path + app_params.order_feed_path, (req, res) => {
    __function.setResult(req, res, 'Websocket - Order Feed');
});

//register application
router.post(`${app_params.feed_path}/auth/register`, check.registrationToken, check.credentials, function (req, res) {
    let username = null;
    try {
        logger.trace(`[${req.timestamp}] Registering user...`);
        if (!req.body.username) {
            throw "Username is invalid or unavailable";
        }
        if (!req.body.clientId) {
            //throw "ClientId is invalid or unavailable";
        }
        let applications = [];
        if (!req.body.applications) {
            logger.writeMany(`[${req.timestamp}] Application name(s) not provided, setting to default`, null, null, ['warning', 'trace']);
            applications = ['default'];
        } else {
            applications = req.body.applications.split(',');
        }
        username = req.body.username;
        let clientid = req.body.clientId || '';
        let clientkey = req.body.consumerKey;
        let clientsecret = req.body.consumerSecret;
        let connections = req.body.connections || app_params.newuser_default.connections;
        let scripts_total = req.body.scripts_total || app_params.newuser_default.scripts_total;
        let token_validity = req.body.token_validity || app_params.newuser_default.token_validity;
        let metadata = JSON.stringify(__function.grabMetadata(req));
        action.register(username, clientid, clientkey, clientsecret, applications, connections, scripts_total, token_validity, metadata, req.timestamp)
            .then(data => {
                __function.setResult(req, res, data);
            })
            .catch(err => {
                __function.setError(req, res, err, `Failed to register user ${username}, err: ${err}`, true);
            });
    } catch (err) {
        __function.setError(req, res, "Registration failed", `Failed to register user ${username}, err: ${err.message || err}`, true);
    }
});

//test
router.get(`${app_params.feed_path}/auth/running`, function (req, res) {
    try {
        __function.setResult(req, res, '{"status":"success"}');
    } catch (err) {
        __function.setError(req, res, '{"status":"error"}', true);
    }
});

//verify user
router.get(`${app_params.feed_path}/auth/verify/user/:username`, check.verificationToken, function (req, res) {
    let username = null;
    try {
        logger.trace(`[${req.timestamp}] Verifying user...`);
        if (!req.params.username) {
            throw "Username invalid or unavailable";
        }
        username = req.params.username;
        action.verify(username, "username", req.timestamp)
            .then(data => {
                __function.setResult(req, res, data);
            })
            .catch(err => {
                __function.setError(req, res, err, `Failed to verify user ${username}, err: ${err}`, true);
            });
    } catch (err) {
        __function.setError(req, res, "Verification failed", `Failed to verify user ${username}, err: ${err.message || err}`, true);
    }
});

//verify clientkey
router.get(`${app_params.feed_path}/auth/verify/key/:clientkey`, check.verificationToken, function (req, res) {
    let clientkey = null;
    try {
        logger.trace(`[${req.timestamp}] Verifying key...`);
        if (!req.params.clientkey) {
            throw "Clientkey invalid or unavailable";
        }
        clientkey = req.params.clientkey;
        action.verify(clientkey, "key", req.timestamp)
            .then(data => {
                __function.setResult(req, res, data);
            })
            .catch(err => {
                __function.setError(req, res, err, `Failed to verify key ${clientkey}, err: ${err}`, true);
            });
    } catch (err) {
        __function.setError(req, res, "Verification failed", `Failed to verify key ${clientkey}, err: ${err.message || err}`, true);
    }
});

//token generate
router.post(`${app_params.feed_path}/auth/token`, check.authorization, function (req, res) {
    let clientkey = req.body.consumerKey;
    try {
        logger.trace(`[${req.timestamp}] Generating/Fetching token...`);
        let regenerate = null;
        let application = req.body.application || "default";
        let scope = req.body.scope || "all";
        let metadata = __function.grabMetadata(req);
        action.token(req.body.consumerKey, req.body.consumerSecret, regenerate, application, scope, JSON.stringify(metadata), req.timestamp)
            .then(data => {
                __function.setResult(req, res, data);
            })
            .catch(err => {
                __function.setError(req, res, err, `Failed to generate token for ${clientkey}, err: ${err}`, true);
            });
    } catch (err) {
        __function.setError(req, res, "Token generation failed", `Failed to generate token for ${clientkey}, err: ${err.message || err}`, true);
    }
});

//token generate
app.post(`${app_params.feed_path}/auth/token/regenerate`, check.authorization, function (req, res) {
    let clientkey = req.body.consumerKey;
    try {
        logger.trace(`[${req.timestamp}] Regenerating token...`);
        let regenerate = true;
        let application = req.body.application || "default";
        let scope = req.body.scope || "all";
        let metadata = __function.grabMetadata(req);
        action.token(req.body.consumerKey, req.body.consumerSecret, regenerate, application, scope, JSON.stringify(metadata), req.timestamp)
            .then(data => {
                __function.setResult(req, res, data);
            })
            .catch(err => {
                __function.setError(req, res, err, `Failed to regenerate token for ${clientkey}, err: ${err}`, true);
            });
    } catch (err) {
        __function.setError(req, res, "Token regeneration failed", `Failed to regenerate token for ${clientkey}, err: ${err.message || err}`, true);
    }
});

//other requests
app.all('*', function (req, res) {
    __function.setError(req, res, "Service does not exists, Invalid API url", `Wrong controller or action called '${req.originalUrl.split('?')[0]}'`, true);
});

// Export 
const appSetObject = (_ip, _nodeId, _redis, _mysql, _function, _logger) => {
    ip = _ip;
    nodeId = _nodeId;
    redis = _redis;
    __function = _function;
    logger = _logger;
    actionSetObject(_redis, _mysql, _function, _logger);
    checkSetObject(_function, _logger);
}
module.exports = { app, appSetObject };