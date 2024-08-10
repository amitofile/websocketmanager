/* 
 * redis connection
 * 
 * Middleware for redis connection
 *   
 * @author Amit P
 * @since 20181219
 * @lastEdit 20191129
 */

let logger = null;
const { redis, redisSetObject } = require('./redis');

class RedisPool {

    constructor(instanceId, appId, connectionId, db, operation, poolSize = 5) {
        this.instanceId = instanceId;
        this.appId = appId;
        try {
            if (poolSize <= 1) {
                let connection_name = `${connectionId}-${appId}-${instanceId}-${db}-${operation}-0`;
                let redisObj = redis.redisConnect(instanceId, appId, connection_name, db, operation);
                this.instences = [redisObj];
                return redisObj
            } else {
                let list = Array.from(Array(poolSize).keys());
                let instences = list.map(function (indx) {
                    let connection_name = `${connectionId}-${appId}-${instanceId}-${db}-${operation}-${indx}`;
                    return redis.redisConnect(instanceId, appId, connection_name, db, operation);
                });
                this.instences = instences;
            }
        } catch (error) {
            logger.writeMany(`[-] Redis pool init failed [error: ${error.message}]`, null, null, ['error', 'trace']);
        }
    }

    nextInstence(object_list) {
        try {
            let instance = object_list.shift();
            object_list.push(instance);
            return instance;
        } catch (error) {
            logger.writeMany(this.instanceId, this.appId, `[-] Redis pool next instance failed [error: ${error.message}]`, null, null, ['error', 'trace']);
        }
    }

    getConnection = () => {
        return this.nextInstence(this.instences);
    }
}

const redisPoolSetObject = (_logger) => {
    logger = _logger;
    redisSetObject(logger);
}
module.exports = { RedisPool, redisPoolSetObject };