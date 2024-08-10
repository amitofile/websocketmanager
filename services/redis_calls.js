

const config = require('config');
const moment = require('moment');

const default_params = config.get('default');
const app_params = config.get('app');
const redis_config = config.get('redis_config');

let logger = null;
const redisObjSet = {};
const redis = () => { };

redis.saveUserMaster = (redisKey, token_data, mysql, req, status) => {
    //saving every master for 30 days in redis
    let expiry = moment().add(30, 'days').unix();
    try {
        //let's verify user first and get user details
        mysql.verifyUserDetails(token_data.username, token_data.application, req.timestamp, (err1, user_details) => {
            if (err1) {
                status(err1, null);
            } else if (!user_details || typeof user_details !== "object" || user_details.length <= 0) {
                status("USER_NOT_FOUND", null);
            } else {
                mysql.verifyTokenDetails(token_data.tokenid, req.timestamp, (err2, token_details) => {
                    if (err2) {
                        status(err2, null);
                    } else if (!token_details || typeof token_details !== "object" || token_details.length <= 0) {
                        status("TOKEN_NOT_FOUND", null);
                    } else {
                        redisObjSet.redis_pool_master_w.getConnection()
                            .pipeline()
                            .hset(redisKey, [
                                'master_name', redisKey,
                                'user_role', user_details.role || 0,
                                'username', user_details.username,
                                'clientid', user_details.clientid,
                                'connections', user_details.connections || app_params.newuser_default.connections,
                                'scripts_total', user_details.scripts_total || app_params.newuser_default.scripts_total,
                                'token_validity', user_details.token_validity || app_params.newuser_default.token_validity,
                                'user_stat', user_details.user_stat || 0,
                                'app_stat', user_details.app_stat || 0,
                                'ips', user_details.ips || '["0.0.0.0"]',
                                'update_master', 0,
                                `token_stat_${token_details.tokenid}`, token_details.expiry || 0
                            ])
                            .expireat(redisKey, expiry)
                            .exec()
                            .then(result => {
                                if (result[0][1] > 0) {
                                    if (!user_details.user_stat) { //check user status
                                        status("USER_INACTIVE", null);
                                    } else if (!user_details.app_stat) { //check application status
                                        status("APP_INACTIVE", null);
                                    } else if (token_details.status != 1) { //check token status
                                        status("TOKEN_INACTIVE", null);
                                    } else { //success
                                        status(null, true);
                                    }
                                } else {
                                    status("STORE_MASTER_FAILED", null);
                                }
                            })
                            .catch(err => {
                                status(err, null);
                            });
                    }
                });
            }
        });
    } catch (error) {
        status(error, null);
    }
}

redis.addTokenInMaster = (redisKey, token_data, mysql, req, status) => {
    try {
        mysql.verifyTokenDetails(token_data.tokenid, req.timestamp, (err2, token_details) => {
            if (err2) {
                status(err2, null);
            } else if (!token_details || typeof token_details !== "object" || token_details.length <= 0) {
                status("TOKEN_NOT_FOUND", null);
            } else {
                redisObjSet.redis_pool_master_w.getConnection()
                    .pipeline()
                    .hset(redisKey, [
                        `token_stat_${token_details.tokenid}`, token_details.expiry || 0
                    ])
                    .exec()
                    .then(result => {
                        if (result[0][1] > 0) {
                            if (token_details.status != 1) { //check token status
                                status("TOKEN_INACTIVE", null);
                            } else {//success
                                status(null, true);
                            }
                        } else {
                            status("STORE_TOKEN_FAILED", null);
                        }
                    })
                    .catch(err => {
                        status(err, null);
                    });
            }
        });
    } catch (error) {
        status(error, null);//`Error while storing user master, ${err.message} [redisKey: ${redisKey}]`
    }
}

redis.getUserMaster = (redisKey, status) => {
    try {
        redisObjSet.redis_pool_master_r.getConnection().hgetall(redisKey, function (err, user_master) {
            if (err) {
                //some unknown error 
                status(err, null);
            }
            if (typeof user_master != "object" || Object.keys(user_master).length == 0) {
                //failed to get master
                status("MASTER_NOT_FOUND", null);
            } else if (user_master.update_master == 1) {
                //master need update
                status("MASTER_UPDATE", null);
            } else if (!user_master.master_name) {
                //rest information required
                status("MASTER_INCOMPLETE", null);
            }
            else {
                //send master details
                status(null, user_master);
            }
        });
    } catch (error) {
        //some unknown error 
        status(error, null);
    }
}

redis.canAllowSession = (req, user_master, tokenId, status) => {
    let redis1 = req.headers.feedtype == app_params.order_feed_path.slice(1) ? redisObjSet.redis_pool_live_ord_r : redisObjSet.redis_pool_live_r;
    let keyId = req.headers.feedtype == app_params.order_feed_path.slice(1) ? "OF" : "MF";
    let allowed_ips = JSON.parse(user_master.ips);

    try {
        //check if requested ip globally blacklisted
        redis.isIpBlacklisted(req, _status => {
            if (_status) {
                status("IP_BLACKLISTED", `request_ip: ${req.headers._ip}`);
            } else {
                //check if requested ip globally whitelisted
                redis.isIpWhitelisted(req, _status => {
                    if (!_status) {
                        status("IP_NOT_WHITELISTED", `request_ip: ${req.headers._ip}`);
                    } else {
                        //check if request is allowed from all or specific IP
                        if (!allowed_ips.includes("0.0.0.0") && !allowed_ips.includes(req.headers._ip)) {
                            status("IP_NOT_ALLOWED", `request_ip: ${req.headers._ip}`);
                        } else {
                            if (!parseInt(user_master[`token_stat_${tokenId}`])) { //check token status
                                status("TOKEN_INACTIVE", null);
                            } else if (!parseInt(user_master.app_stat)) { //check application status
                                status("APP_INACTIVE", null);
                            } else if (!parseInt(user_master.user_stat)) { //check user status
                                status("USER_INACTIVE", null);
                            } else {
                                //get total current connections
                                let _redisKey = `${user_master.master_name}_live_sessions`;
                                redis1.getConnection().scard(_redisKey, (err1, connection_count) => {
                                    if (err1) {
                                        //geting connection count failed
                                        status(err1, null);
                                    } else {
                                        let allowed_connections = parseInt(user_master.connections);
                                        //check is within allowed count
                                        if (connection_count < allowed_connections) {
                                            //is feed available to connect
                                            redis.getAvailableFeed(keyId, (err, _target) => {
                                                if (err || !_target) {
                                                    status(err.message, null);
                                                } else {
                                                    status(null, `sessions: ${connection_count}/${allowed_connections}`);
                                                }
                                            });
                                        } else {
                                            status("RATE_LIMIT", `sessions: ${connection_count}/${allowed_connections}`); // rate limt
                                        }
                                    }
                                });
                            }
                        }
                    }
                });
            }
        });
    } catch (error) {
        //unknown error
        status(error, null);
    }
}

redis.addSession = (req, tokenid, status) => {
    let redis1 = req.headers.feedtype == app_params.order_feed_path.slice(1) ? redisObjSet.redis_pool_live_ord_w : redisObjSet.redis_pool_live_w;
    let redis2 = req.headers.feedtype == app_params.order_feed_path.slice(1) ? redisObjSet.redis_pool_session_ord_w : redisObjSet.redis_pool_session_w;
    let expiry = moment().add(redis_config.key_expiry[0], redis_config.key_expiry[1]).unix();
    try {
        let sessionsKey = `${req.headers.userapp}_live_sessions`;
        let userSessionKey = `${req.headers.userapp}:${req.headers.uuid}`;
        redis1.getConnection()
            .pipeline()
            .sadd(sessionsKey, req.headers.uuid)
            .expireat(sessionsKey, expiry)
            .exec()
            .then(result => {
                if (result[0][1] > 0) {
                    status(null, true);
                } else {
                    status({ message: "STORE_LIVE_FAILED" }, null);
                }
            })
            .catch(err => {
                status(err, null);
            });

        redis2.getConnection()
            .pipeline()
            .hset(userSessionKey, [
                'socketId', null,
                'ip', req.headers._ip,
                'tokenId', tokenid,
                'start', moment().format(default_params.log_date_format),
                'end', null,
                'remark', null,
                'remark2', null,
                'remark3', null,
                'ping', moment().format(default_params.log_date_format)
            ])
            .expireat(userSessionKey, expiry)
            .exec();

    } catch (error) {
        status(error, null);
    }
}

redis.removeSession = (req, remark = null, remark2 = null, status) => {
    let redis1 = req.headers.feedtype == app_params.order_feed_path.slice(1) ? redisObjSet.redis_pool_live_ord_w : redisObjSet.redis_pool_live_w;
    let redis2 = req.headers.feedtype == app_params.order_feed_path.slice(1) ? redisObjSet.redis_pool_session_ord_w : redisObjSet.redis_pool_session_w;
    try {
        let sessionsKey = `${req.headers.userapp}_live_sessions`;
        let userSessionKey = `${req.headers.userapp}:${req.headers.uuid}`;
        redis1.getConnection()
            .pipeline()
            .srem(sessionsKey, req.headers.uuid)
            .exec()
            .then(result => {
                if (result[0][1] > 0) {
                    status(null, true);
                } else {
                    status({ message: "REMOVE_LIVE_FAILED" }, false);
                }
            })
            .catch(err => {
                status(err, false);
            });

        redis2.getConnection()
            .pipeline()
            .hset(userSessionKey, [
                'end', moment().format(default_params.log_date_format),
                'remark', remark,
                'remark2', remark2
            ])
            .exec();

    } catch (error) {
        status(error, false);
    }
}

redis.getAvailableFeed = (keyId, status) => {
    try {
        redisObjSet.redis_pool_feeder_r.getConnection().keys(`${keyId}:*`, (err, feeds) => {
            if (err || !feeds || typeof feeds !== 'object' || feeds.length <= 0) {
                if (!err) {
                    err = { message: 'FEED_NOT_AVAILABLE' }
                }
                status(err, null);
            } else {
                let target = feeds[Math.floor(Math.random() * feeds.length)].split(':');
                status(null, target);
            }
        });
    } catch (error) {
        status(error, null);
    }
}

redis.incrementStatVal = (key, status) => {
    try {
        redisObjSet.redis_pool_stats_w.getConnection().incr(key, (err, new_count) => {
            if (err || !new_count || new_count <= 0) {
                if (!err) {
                    err = { message: 'MASTER_INCREMENT_FAILED' }
                }
                status(err, null);
            } else {
                status(null, new_count);
            }
        });
    } catch (error) {
        status(error, null);
    }
}

redis.resetStatVal = (key, status) => {
    try {
        redisObjSet.redis_pool_stats_w.getConnection().set(key, 0, (err, new_count) => {
            if (err || !new_count || new_count <= 0) {
                if (!err) {
                    err = { message: 'STAT_RESET_FAILED' }
                }
                status(err, null);
            } else {
                status(null, new_count);
            }
        });
    } catch (error) {
        status(error, null);
    }
}

redis.resetMasterVal = (key, field, status) => {
    try {
        redisObjSet.redis_pool_master_w.getConnection().hset(key, [field, 0], (err, new_count) => {
            if (err || !new_count || new_count <= 0) {
                if (!err) {
                    err = { message: 'MASTER_RESET_FAILED' }
                }
                status(err, null);
            } else {
                status(null, new_count);
            }
        });
    } catch (error) {
        status(error, null);
    }
}

redis.isIpBlacklisted = (req, status) => {
    redisObjSet.redis_pool_settings_r.getConnection().sismember("ip_blacklist", req.headers._ip, (err, result) => {
        if (err) {
            logger.writeMany(`[${req.timestamp}] Failed to get ip blacklist details [err: ${err.message}]`, null, null, ['error', 'trace']);
            //error - block this connection
            status(true);
        } else {
            if (default_params.DEBUG) logger.trace(`[${req.timestamp}] Validating against blacklist (main) [${req.headers._ip}] = ${result}`);
            if (result) {
                //1 - blacklisted - block this connection
                status(100);
            } else {
                //0 - not blacklisted
                redisObjSet.redis_pool_settings_r.getConnection().sismember("ip_blacklist_temp", req.headers._ip, (err1, result1) => {
                    if (err1) {
                        logger.writeMany(`[${req.timestamp}] Failed to get ip blacklist details [err: ${err1.message}]`, null, null, ['error', 'trace']);
                        //error - block this connection
                        status(true);
                    } else {
                        if (default_params.DEBUG) logger.trace(`[${req.timestamp}] Validating against blacklist (temp) [${req.headers._ip}] = ${result1}`);
                        if (result1) {
                            //1 - blacklisted - block this connection
                            status(true);
                        } else {
                            //0 - not blacklisted
                            status(false);
                        }
                    }
                });
            }
        }
    });
}

redis.isIpWhitelisted = (req, status) => {
    redisObjSet.redis_pool_settings_r.getConnection().smismember("ip_whitelist", "0.0.0.0", req.headers._ip, (err, result) => {
        if (err) {
            logger.writeMany(`[${req.timestamp}] Failed to get ip whitelist details [err: ${err.message}]`, null, null, ['error', 'trace']);
            //error - block this connection
            status(false);
        } else {
            if (default_params.DEBUG) logger.trace(`[${req.timestamp}] Validating against whitelist [0.0.0.0, ${req.headers._ip}] = ${result}`);
            if (result[0] == 1) {
                //all connections accepted
                status(true);
            } else if (result[1] == 1) {
                //ip whitelisted
                status(true);
            } else {
                //ip not whitelisted
                status(false);
            }
        }
    });
}

redis.uploadIpBlacklist = (list, status) => {
    redisObjSet.redis_pool_settings_w.getConnection().pipeline()
        .del("ip_blacklist")
        .sadd("ip_blacklist", list)
        .exec()
        .then(result => {
            status(null, result[1][0]);
        })
        .catch(err => {
            status(err, null);
        });
}

redis.uploadIpWhitelist = (list, status) => {
    redisObjSet.redis_pool_settings_w.getConnection().pipeline()
        .del("ip_whitelist")
        .sadd("ip_whitelist", list)
        .exec()
        .then(result => {
            status(null, result[1][0]);
        })
        .catch(err => {
            status(err, null);
        });
}

redis.clearLiveSessions = (status) => {
    redisObjSet.redis_pool_live_w.getConnection().flushdb();
    redisObjSet.redis_pool_live_ord_w.getConnection().flushdb();
}

redis.addFault = (client_msg, log_msg, req = null) => {
    redisObjSet.redis_pool_stats_w.getConnection().xadd('fault', "*", "timestamp", req && req.timestamp ? req.timestamp : '-', "IP", req && req.headers._ip ? req.headers._ip : '-', "response", client_msg, "log", log_msg, "url", req ? req.url : '-', "meta", req ? JSON.stringify(req.headers) : '-');
}

const redisSetObject = (instanceId, appId, nodeId, _logger) => {
    logger = _logger;
    const { RedisPool, redisPoolSetObject } = require('../include/redis_pool');
    redisPoolSetObject(_logger);

    _logger.trace('[-] Loading Redis connections...');
    redisObjSet.redis_pool_master_r = new RedisPool(instanceId, appId, nodeId, redis_config.db.master, 'r');
    redisObjSet.redis_pool_master_w = new RedisPool(instanceId, appId, nodeId, redis_config.db.master, 'w');
    redisObjSet.redis_pool_session_w = new RedisPool(instanceId, appId, nodeId, redis_config.db.session_details, 'w');
    redisObjSet.redis_pool_session_r = new RedisPool(instanceId, appId, nodeId, redis_config.db.session_details, 'r');
    redisObjSet.redis_pool_feeder_r = new RedisPool(instanceId, appId, nodeId, redis_config.db.feeder_status, 'r');
    redisObjSet.redis_pool_stats_w = new RedisPool(instanceId, appId, nodeId, redis_config.db.stats, 'w');
    redisObjSet.redis_pool_settings_r = new RedisPool(instanceId, appId, nodeId, redis_config.db.settings, 'r');
    redisObjSet.redis_pool_settings_w = new RedisPool(instanceId, appId, nodeId, redis_config.db.settings, 'w');
    redisObjSet.redis_pool_live_w = new RedisPool(instanceId, appId, nodeId, redis_config.db.live_sessions, 'w');
    redisObjSet.redis_pool_live_r = new RedisPool(instanceId, appId, nodeId, redis_config.db.live_sessions, 'r');
    redisObjSet.redis_pool_session_ord_w = new RedisPool(instanceId, appId, nodeId, redis_config.db.session_details_orders, 'w');
    redisObjSet.redis_pool_session_ord_r = new RedisPool(instanceId, appId, nodeId, redis_config.db.session_details_orders, 'r');
    redisObjSet.redis_pool_live_ord_w = new RedisPool(instanceId, appId, nodeId, redis_config.db.live_sessions_orders, 'w');
    redisObjSet.redis_pool_live_ord_r = new RedisPool(instanceId, appId, nodeId, redis_config.db.live_sessions_orders, 'r');
    _logger.trace('[-] Done loading Redis.');

}
module.exports = { redis, redisSetObject };
