/* 
 * redis connection
 * 
 * Middleware for redis connection
 *   
 * @author Amit P
 * @since 20181219
 * @lastEdit 20191129
 */
const Redis = require("ioredis");
const config = require('config');
const moment = require('moment');

const default_params = config.get('default');
const redis_config = config.get('redis_config');

let logger = null;

const redis = () => { };

redis.redisConnect = (instanceId, appId, connectionId, _db = 0, operation = 'w') => {
    let start = null;
    let connection_name = `${config.get('default.application')}-${connectionId}`;
    let options = {};
    if (default_params.ENV == "development") {
        options = {
            host: redis_config.host,
            port: redis_config.port,
            name: redis_config.master_name,
            password: redis_config.auth,
            db: _db,
            retryStrategy: function (times) {
                const delay = Math.min(times * 10, 1000);
                return delay;
            }
        };
    } else {
        options = {
            sentinels: redis_config.sentinels,
            name: redis_config.master_name,
            password: redis_config.auth,
            //sentinelPassword: redis_config.auth,
            db: _db,
            sentinelRetryStrategy: function (times) {
                const delay = Math.min(times * 10, 1000);
                return delay;
            }
        };
        if (operation && operation == 'r') {
            options.role = 'slave';
        }
    }
    const redisObj = new Redis(options);
    redisObj.on('connect', function () {
        start = moment().format(config.get("default.log_date_format"));
        //logger.trace(`[-] Redis connected, db: ${_db}, role: ${operation == 'r' ? 'slave' : 'master'} [${connection_name}, ${start}]`);
        if (default_params.DEBUG) logger.trace(`[-] Redis connected, Client name set to: ${connection_name} [${start}]`);
    });
    redisObj.on('reconnecting', function (info) {
        redisObj.client('SETNAME', connection_name, function (err, res) {
            logger.trace(`[-] Redis reconnected, Client name set to: ${connection_name}`);
        });
    });
    redisObj.on('warning', function (msg) {
        logger.writeMany(`[-] Redis warning: ${msg} [${connection_name}]`, null, null, ['warning', 'trace']);
    });
    redisObj.on('error', function (err) {
        logger.writeMany(`[-] Redis error: ${err.toString()} [${connection_name}]`, null, null, ['error', 'trace']);
    });
    redisObj.on('close', function () {
        let temp = start + '-' + moment().format(config.get("default.log_date_format"));
        logger.writeMany(`[-] Redis disconnected, Connection name: ${connection_name} [${temp}]`, null, null, ['warning', 'trace']);
    });
    redisObj.client('SETNAME', connection_name, function (err, res) {
        if (err) {
            logger.writeMany(`[-] Failed to set client name to: ${connection_name} [${err.message}]`, null, null, ['error', 'trace']);
        }
        //logger.trace(`[-] Redis Client name set to: ${connection_name}`);
    });

    if (redis_config.keepAlive) {
        setInterval(() => {
            redisObj.ping((err, result) => {
                //console.log(result);
            });
        }, 10000);
    }
    return redisObj;
};

const redisSetObject = (_logger) => {
    logger = _logger;
}
module.exports = { redis, redisSetObject };
