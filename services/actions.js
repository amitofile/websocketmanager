const config = require('config');
const moment = require('moment');
//const { v4: uuidv4 } = require('uuid');
const ShortUniqueId = require('short-unique-id');

const app_params = config.get('app');
const default_params = config.get('default');
const uid = new ShortUniqueId({ length: 16 });

let redis = null, mysql = null, __function = null, logger = null;

var action = function () { };

action.register = (username, clientid, clientkey, clientsecret, applications, connections, scripts_total, token_validity, metadata, req_timestamp) => {
    return new Promise((resolve, reject) => {
        let _err = `Failed to register user ${username}`;
        mysql.addUser(username, clientid, clientkey, clientsecret, applications, connections, scripts_total, token_validity, metadata, req_timestamp, (err, result) => {
            if (err) {
                logger.writeMany(`[${req_timestamp}] mysql: ${err}`, null, null, ['error', 'trace']);
                return reject(_err);
            }
            if (result) {
                resolve(`User ${username} registered`);
            } else {
                logger.writeMany(`[${req_timestamp}] No insert id`, null, null, ['error', 'trace']);
                return reject(_err);
            }
        });
    });
};

action.verify = (identity, type, req_timestamp) => {
    return new Promise((resolve, reject) => {
        let _err = `Failed to verify ${type} ${identity}`;
        if (type == "key") {
            mysql.verifyClientKey(identity, req_timestamp, (err, record) => {
                if (err) {
                    logger.writeMany(`[${req_timestamp}] mysql: ${err}`, null, null, ['error', 'trace']);
                    return reject(_err);
                }
                if (record) {
                    resolve("Key Found");
                } else {
                    logger.writeMany(`[${req_timestamp}] Invalid response`, null, null, ['error', 'trace']);
                    return reject(_err);
                }
            });
        } else {
            mysql.verifyUser(identity, req_timestamp, (err, record) => {
                if (err) {
                    logger.writeMany(`[${req_timestamp}] mysql: ${err}`, null, null, ['error', 'trace']);
                    return reject(_err);
                }
                if (record) {
                    resolve("User Found");
                } else {
                    logger.writeMany(`[${req_timestamp}] Invalid response`, null, null, ['error', 'trace']);
                    return reject(_err);
                }
            });
        }
    });
};

action.token = (clientkey, clientsecret, regenerate, _application, _scope, metadata, req_timestamp) => {
    return new Promise((resolve, reject) => {
        let _err = `Failed to generate token`;
        if (!app_params.allowed_socpes.includes(_scope)) {
            _err += `, invalid scope value. Expected values ${app_params.allowed_socpes}`;
            logger.writeMany(`[${req_timestamp}] ${_err}`, null, null, ['error', 'trace']);
            return reject(_err);
        }
        //let's check user details
        mysql.verifyClientKey(clientkey, req_timestamp, (err, record) => {
            if (err || !record) {
                //user not found
                _err += ", client record not found"
                logger.writeMany(`[${req_timestamp}] Failed to get record [clientkey: ${clientkey}]`, null, null, ['error', 'trace']);
                if (err) {
                    logger.writeMany(`[${req_timestamp}] mysql: ${err}`, null, null, ['error', 'trace']);
                }
                return reject(_err);
            }
            if (!record.username || !record.clientsecret) {
                //some details missing
                _err += ", invalid record found"
                logger.writeMany(`[${req_timestamp}] Invalid record [clientkey: ${clientkey}]`, null, null, ['error', 'trace']);
                logger.writeMany(`[${req_timestamp}] Invalid record [record: ${JSON.stringify(record)}]`, null, null, ['info', 'trace']);
                if (err) {
                    logger.writeMany(`[${req_timestamp}] mysql: ${err}`, null, null, ['error', 'trace']);
                }
                return reject(_err);
            }
            if (record.status == 0) {
                //user inactive
                _err += ", user not active"
                logger.writeMany(`[${req_timestamp}] User is inactive [clientkey: ${clientkey}]`, null, null, ['error', 'trace']);
                return reject(_err);
            }
            if (record.clientsecret != clientsecret) {
                //provided secret doesnot match
                _err += ", invalid client credentials"
                logger.writeMany(`[${req_timestamp}] clientSecret do not match, [clientkey: ${clientkey}]`, null, null, ['error', 'trace']);
                logger.writeMany(`[${req_timestamp}] clientSecret do not match, [received: ${clientsecret}]`, null, null, ['info', 'trace']);
                return reject(_err);
            }
            //let's check application details
            mysql.verifyApplication(record.username, _application, req_timestamp, (err1, record1) => {
                if (err1 || !record1) {
                    //application not found
                    _err += ", valid application not found";
                    logger.writeMany(`[${req_timestamp}] Failed to get application [clientkey: ${clientkey}, application: ${_application}]`, null, null, ['error', 'trace']);
                    if (err1) {
                        logger.writeMany(`[${req_timestamp}] mysql: ${err1}`, null, null, ['error', 'trace']);
                    }
                    return reject(_err);
                }
                if (record1.status == 0) {
                    //application inactive
                    _err += ", application not active"
                    logger.writeMany(`[${req_timestamp}] User application is inactive [clientkey: ${clientkey}, application: ${_application}]`, null, null, ['error', 'trace']);
                    return reject(_err);
                }
                //let's check whether we already have valid token
                mysql.fetchLastToken(record.username, _application, _scope, req_timestamp, (err2, last_token) => {
                    if (err2) {
                        if (err2 == 'TOKEN_NOT_FOUND') {
                            //token not available - make new
                            regenerate = true;
                        } else {
                            //some unknown error
                            logger.writeMany(`[${req_timestamp}] mysql: ${err2} [clientkey: ${clientkey}]`, null, null, ['error', 'trace']);
                            return reject(_err);
                        }
                    }
                    if (!last_token || regenerate == true || regenerate == "true" || regenerate == "yes") {
                        //token not available - make new | forcefull regenerate
                        logger.writeMany(`[${req_timestamp}] Regenerating access token [clientkey: ${clientkey}, application: ${_application}]`, null, null, ['warning', 'trace']);
                        regenerate = true;
                    }
                    //if last token available, let's check expiry
                    let is_token_expired = null;
                    if (last_token)
                        is_token_expired = moment(last_token.expiry, default_params.log_date_format).diff(moment(), 'seconds') < app_params.jwt_min_diff;

                    if (regenerate || is_token_expired) {
                        //either forcefull regenerate or expired token - let's make new
                        let _tokenid = uid(); //uuidv4();
                        let validity = record1.token_validity || app_params.newuser_default.token_validity;
                        let now = moment();
                        let _expiry = moment(now).add(validity, 'minutes').format(default_params.log_date_format);
                        let payload = {
                            username: record.username,
                            application: _application,
                            tokenid: _tokenid,
                            expiry: _expiry,
                            scope: _scope
                        }
                        logger.writeMany(`[${req_timestamp}] Generating new JWT for payload => ${JSON.stringify(payload)} with expiry => ${validity} min [${_expiry}]...`, null, null, ['info', 'trace']);
                        let jwt = __function.generateAccessToken(payload, validity);
                        logger.writeMany(`[${req_timestamp}] JWT: ${jwt}`, null, null, ['info', 'trace']);

                        if (regenerate && last_token && !is_token_expired) {
                            //forcefull regenerate + active token exists 
                            //make new token and disable existing
                            logger.writeMany(`[${req_timestamp}] Disabling last active token ${last_token.tokenid}...`, null, null, ['info', 'trace']);
                            //soft delete from records
                            mysql.removeToken(metadata, last_token.tokenid, req_timestamp, (err4, result) => {
                                if (err4) {
                                    _err += ", try again"
                                    logger.writeMany(`[${req_timestamp}] username: ${record.username}, mysql: ${err4}`, null, null, ['error', 'trace']);
                                    return reject(_err);
                                } else {
                                    logger.trace(`[${req_timestamp}] token removed from records, now disabling in master...`);
                                    //make inactive in master (if already used)
                                    let redis_key = `${last_token.username}_${last_token.application}`;
                                    redis.resetMasterVal(redis_key, [`token_stat_${last_token.tokenid}`, 0], (err5, status5) => {
                                        if (err5) {
                                            _err += ", try again"
                                            logger.writeMany(`[${req_timestamp}] usermaster: ${redis_key}, err: ${err5.message}`, null, null, ['error', 'trace']);
                                            return reject(_err);
                                        } else {
                                            logger.trace(`[${req_timestamp}] token disabled in masters, now adding new in records...`);
                                            //forcefull regenerate of non expired token - add new in records
                                            mysql.addToken(_tokenid, record.username, _application, jwt, validity, _expiry, _scope, now, metadata, req_timestamp, (err3, result) => {
                                                if (err3) {
                                                    _err += ", try again"
                                                    logger.writeMany(`[${req_timestamp}] username: ${record.username}, mysql: ${err3}`, null, null, ['error', 'trace']);
                                                    return reject(_err);
                                                }
                                                if (result) {
                                                    resolve({ access_token: jwt, expiry: _expiry });
                                                } else {
                                                    _err += ", try again"
                                                    logger.writeMany(`[${req_timestamp}] username: ${record.username}, err: Failed adding token`, null, null, ['error', 'trace']);
                                                    return reject(_err);
                                                }
                                            });
                                        }
                                    });
                                }
                            });
                        } else {
                            //either forcefull regenerate or expired token - add new in records
                            mysql.addToken(_tokenid, record.username, _application, jwt, validity, _expiry, _scope, now, metadata, req_timestamp, (err3, result) => {
                                if (err3) {
                                    _err += ", try again"
                                    logger.writeMany(`[${req_timestamp}] username: ${record.username}, mysql: ${err3}`, null, null, ['error', 'trace']);
                                    return reject(_err);
                                }
                                if (result) {
                                    resolve({ access_token: jwt, expiry: _expiry });
                                } else {
                                    _err += ", try again"
                                    logger.writeMany(`[${req_timestamp}] username: ${record.username}, Failed adding token`, null, null, ['error', 'trace']);
                                    return reject(_err);
                                }
                            });
                        }
                    } else {
                        logger.trace(`[${req_timestamp}] Sending existing token...`);
                        resolve({ access_token: last_token.jwt, expiry: last_token.expiry });
                    }
                });
            });
        });
    });
};

// Export 
const actionSetObject = (_redis, _mysql, _function, _logger) => {
    redis = _redis;
    mysql = _mysql;
    __function =_function;
    logger = _logger;
}
module.exports = { action, actionSetObject };