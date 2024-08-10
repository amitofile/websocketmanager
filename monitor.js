/** 
 * 
 * @author Amit P
 * @since 20181213
 * @lastedit 20220818 
 */

// Load global modules
const config = require('config');
const moment = require('moment');
const argv = require('minimist')(process.argv.slice(2));
const NodeCache = require("node-cache");

const default_params = config.get('default');
const app_params = config.get('app');
const redis_config = config.get('redis_config');
const blacklist_ips = new NodeCache();

const env = process.env.NODE_ENV || default_params.ENV;
const _ip = env == "development" ? '127.0.0.1' : JSON.parse(require('fs').readFileSync('./config/node.json')).id;
const feedtype = argv.feedType || "prices";
const nodeId = _ip.replaceAll('.', '');
const instanceId = `INST${nodeId}${process.pid}`;
const appId = 'monitor';

const { logger, loggerSetObject } = require('./include/logger');
loggerSetObject(instanceId, appId);
const { RedisPool, redisPoolSetObject } = require('./include/redis_pool');
redisPoolSetObject(logger);

const redis_pool_live_w = new RedisPool(instanceId, appId, nodeId, redis_config.db.live_sessions, 'w');
const redis_pool_live_r = new RedisPool(instanceId, appId, nodeId, redis_config.db.live_sessions, 'r');
const redis_pool_session_r = new RedisPool(instanceId, appId, nodeId, redis_config.db.session_details, 'r');
const redis_pool_session_w = new RedisPool(instanceId, appId, nodeId, redis_config.db.session_details, 'w');
const redis_pool_stats_w = new RedisPool(instanceId, appId, nodeId, redis_config.db.stats, 'w');
const redis_pool_live_ord_w = new RedisPool(instanceId, appId, nodeId, redis_config.db.live_sessions_orders, 'w');
const redis_pool_live_ord_r = new RedisPool(instanceId, appId, nodeId, redis_config.db.live_sessions_orders, 'r');
const redis_pool_session_ord_r = new RedisPool(instanceId, appId, nodeId, redis_config.db.session_details_orders, 'r');
const redis_pool_session_ord_w = new RedisPool(instanceId, appId, nodeId, redis_config.db.session_details_orders, 'w');
const redis_pool_master_r = new RedisPool(instanceId, appId, nodeId, redis_config.db.master, 'r');

//Bot test logic only with price monitor - single run enough
let redis_settings_r = null, redis_pool_stats_r = null, redis_settings_w = null;
if (feedtype != app_params.order_feed_path.slice(1)) {
    redis_pool_stats_r = new RedisPool(instanceId, appId, nodeId, redis_config.db.stats, 'r');
    redis_settings_r = new RedisPool(instanceId, appId, nodeId, redis_config.db.settings, 'r', 1);
    redis_settings_w = new RedisPool(instanceId, appId, nodeId, redis_config.db.settings, 'w', 1);
}

let live_apps = new Set([]);
let live_users = new Set([]);
let live_sessions = new Set([]);

function pingMaster(feedtype) {
    let redis_session_r = feedtype == app_params.order_feed_path.slice(1) ? redis_pool_session_ord_r : redis_pool_session_r;
    let redis_session_w = feedtype == app_params.order_feed_path.slice(1) ? redis_pool_session_ord_w : redis_pool_session_w;
    let redis_live_r = feedtype == app_params.order_feed_path.slice(1) ? redis_pool_live_ord_r : redis_pool_live_r;
    let redis_live_w = feedtype == app_params.order_feed_path.slice(1) ? redis_pool_live_ord_w : redis_pool_live_w;

    let session_count = 0;

    const stream = redis_live_r.getConnection().scanStream();

    stream.on("data", (live_sessions_keys) => {
        stream.pause();
        Promise.all(live_sessions_keys.map(async live_session => {
            let user_app = live_session.replace('_live_sessions', '');
            let user = user_app.split('_')[0];
            //console.log(user_app);
            await redis_live_r.getConnection().smembers(live_session, (err, sessionIds) => {
                if (err)
                    throw Error(err);
                const start = async () => {
                    await sessionIds.forEach(async session => {
                        session_count++;
                        let _session = `${user_app}:${session}`;
                        //console.log(_session);
                        await redis_session_r.getConnection().hgetall(_session, async (err0, result0) => {
                            if (err0)
                                throw Error(err0);
                            //console.log(result0);
                            if (!result0.end) {
                                await redis_pool_master_r.getConnection().hget(user_app, "token_stat_" + result0.tokenId, async (err2, token_expiry) => {
                                    let now = moment();
                                    if (now.diff(moment(token_expiry, default_params.log_date_format), 'seconds') > 0) {
                                        //token expired - remove from live list
                                        await redis_live_w.getConnection().srem(live_session, session, (err1, status1) => {
                                            if (err1)
                                                throw Error(err1);
                                            logger.writeMany(`[-] ${live_session} -> ${session} removed. (token expired)`, null, null, ['warning', 'trace']);
                                            redis_session_w.getConnection().hset(_session, ['remark3', 'Websocket terminated due to token expired'], err => {
                                                if (err)
                                                    logger.writeMany(`[-] Failed to save remark3 in session details, err: ${err.message}`, null, null, ['error', 'trace']);
                                            });
                                        });
                                    } else if (now.diff(moment(result0.ping, default_params.log_date_format), 'minutes') > app_params.ping_validity) {
                                        //connection inactive - remove from live list
                                        await redis_live_w.getConnection().srem(live_session, session, (err1, status1) => {
                                            if (err1)
                                                throw Error(err1);
                                            logger.writeMany(`[-] ${live_session} -> ${session} removed. (connection inactive)`, null, null, ['warning', 'trace']);
                                            redis_session_w.getConnection().hset(_session, ['remark3', 'Websocket terminated due to connection inactive'], err => {
                                                if (err)
                                                    logger.writeMany(`[-] Failed to save remark3 in session details, err: ${err.message}`, null, null, ['error', 'trace']);
                                            });
                                        });
                                    } else {
                                        //connection active
                                        live_apps.add(user_app);
                                        live_users.add(user);
                                        live_sessions.add(_session);
                                        //console.log(sessionIds, session);
                                        //if (!sessionIds.includes(session)) {
                                        //    //add to live list
                                        //    await redis_live_w.getConnection().sadd(live_session, session, (err1, status3) => {
                                        //        if (err1)
                                        //            throw Error(err1);
                                        //        logger.writeMany(`[-] ${live_session} <- ${session} added.`, null, null, ['warning', 'trace']);
                                        //    });
                                        //}
                                    }
                                });
                            }
                        });
                    });
                }
                start();
            });
        })).then(async () => {
            await stream.resume();
        });
    });
    stream.on("end", () => {
        logger.info(`[-] Total scanned sessions: ${session_count}, live sessions: ${live_sessions.size}, live apps: ${live_apps.size}, live users: ${live_users.size}`);
        //console.log(live_users);
        redis_pool_stats_w.getConnection().set(`live:${feedtype}:users`, JSON.stringify([...live_users]), (err, status) => {
            if (err)
                throw Error(err);
        });
        //console.log(live_apps);
        redis_pool_stats_w.getConnection().set(`live:${feedtype}:apps`, JSON.stringify([...live_apps]), (err, status) => {
            if (err)
                throw Error(err);
        });
        //console.log(live_sessions);
        redis_pool_stats_w.getConnection().set(`live:${feedtype}:sessions`, JSON.stringify([...live_sessions]), (err, status) => {
            if (err)
                throw Error(err);
        });
        live_apps.clear();
        live_users.clear();
        live_sessions.clear();
        setTimeout(() => {
            pingMaster(feedtype);
        }, app_params.monitor * 1000);
    });
}
let bot_test_timer = null;
function botTestTemp() {
    redis_settings_r.smembers("ip_blacklist_temp", (err, IPBlacklist) => {
        if (err)
            throw Error(err);
        logger.info(`[-] IP Blacklist: ${JSON.stringify(IPBlacklist)} (temp)`);
        let stream = redis_pool_stats_r.getConnection().scanStream({ match: "bottest:*" });
        stream.on("data", (botTest_ips) => {
            stream.pause();
            Promise.all(botTest_ips.map(async ip => {
                await redis_pool_stats_r.getConnection().get(ip, async (err0, count) => {
                    if (err0)
                        throw Error(err0);
                    let _ip = ip.split(':')[1];
                    if (count > app_params.faulty_hits_limit && !IPBlacklist.includes(_ip)) {
                        await redis_settings_w.sadd("ip_blacklist_temp", _ip, (err1, status) => {
                            if (err1)
                                throw Error(err1);
                            if (default_params.DEBUG) logger.trace(`[-] ${_ip} added in temp blacklist`);
                        });
                        await redis_pool_stats_w.getConnection().del(`bottest:${_ip}`, (err1, status) => {
                            if (err1)
                                throw Error(err1);
                            if (default_params.DEBUG) logger.trace(`[-] Bottest cleared for ${_ip}`);
                        });
                    }
                });
            })).then(async () => {
                await stream.resume();
            });
        });

        stream.on("end", () => {
            setTimeout(() => {
                botTestTemp()
            }, app_params.monitor * 1000);

            if (!bot_test_timer) {
                if (default_params.DEBUG) logger.trace(`[-] botTest() will run after ${app_params.monitor2} seconds`);
                bot_test_timer = setTimeout(() => {
                    botTest();
                }, app_params.monitor2 * 1000);
            }
        });
    });
}

function botTest() {
    //clear timer
    bot_test_timer = null;
    //get main blacklist
    redis_settings_r.smembers("ip_blacklist", (err, IPBlacklist) => {
        if (err)
            throw Error(err);
        logger.info(`[-] IP Blacklist: ${JSON.stringify(IPBlacklist)} (main)`);
        //get temp blacklist
        redis_settings_r.smembers("ip_blacklist_temp", (err, IPBlacklistTemp) => {
            if (err)
                throw Error(err);
            //check every IP from temp blacklist
            IPBlacklistTemp.forEach(async ip => {
                //increment count if IP exists in cache
                let count = blacklist_ips.get(ip) ? blacklist_ips.get(ip) + 1 : 1;
                if (default_params.DEBUG) logger.trace(`[-] ${ip}: ${count}`);
                //if count is greater than 5 and ip doesnot belong to main list
                if (count > 5 && !IPBlacklist.includes(ip)) {
                    //shift ip to main blacklist
                    await redis_settings_w.sadd("ip_blacklist", ip, async (err1, status) => {
                        if (err1)
                            throw Error(err1);
                        if (default_params.DEBUG) logger.trace(`[-] Added ${ip} to main blacklist`);
                        //clear from cache
                        blacklist_ips.del(ip);
                        if (default_params.DEBUG) logger.trace(`[-] Removed ${ip} from cache`);
                    });
                } else {
                    //if count is less than 5 just set new count
                    blacklist_ips.set(ip, count);
                    //remove IP from temp list.
                    //removing after monitor2 time
                    await redis_settings_w.srem("ip_blacklist_temp", ip, (err1, status) => {
                        if (err1)
                            throw Error(err1);
                        if (default_params.DEBUG) logger.trace(`[-] Removed ${ip} form temp blacklist`);
                    });
                }
            });
        });
        logger.info(`[-] IP Blacklist cache: ${blacklist_ips.keys()}`);
    });
}

try {
    logger.trace(`[-] Monitor started for ${feedtype} feed`);
    pingMaster(feedtype);
    //Bot test logic only with price monitor - single run enough
    if (feedtype != app_params.order_feed_path.slice(1))
        botTestTemp();
} catch (error) {
    logger.writeMany(error.message, null, null, ['error', 'trace']);
}

