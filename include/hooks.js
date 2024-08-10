/** 
 * 
 * @author Amit P
 * @since 20181213
 * @lastedit 20220818 
 */

// Load global modules

let redis = null, mysql = null, logger = null;

const hook = function () { };

hook.run = async () => {
    //test mysql
    await mysql.testConnection((err, status) => {
        if (err || !status) {
            logger.writeMany(`[-] MariaDB Failed, err: ${err ? err.message : '-'}.`, null, null, ['error', 'trace']);
            process.exit(0);
        } else {
            logger.trace("[-] MariaDB OK.");
        }
    });

    //clear all previous sessions
    await redis.clearLiveSessions((err, result) => {
        if (err) {
            logger.writeMany(`[-] Failed to clear live sessions on (re)start, err: ${err.message}.`, null, null, ['error', 'trace']);
        } else {
            logger.trace("[-] All previous sessions cleared after (re)start.");
        }
    });

    //upload ip blacklist
    await redis.uploadIpBlacklist(JSON.parse(require('fs').readFileSync(__dirname + '/../config/ip_blacklist.json')), (err, result) => {
        if (err) {
            logger.writeMany(`[-] Failed to upload IP blacklist, err: ${err.message}.`, null, null, ['error', 'trace']);
        } else {
            logger.trace("[-] IP blacklist saved in memory.");
        }
    });

    //upload ip whitelist
    await redis.uploadIpWhitelist(JSON.parse(require('fs').readFileSync(__dirname + '/../config/ip_whitelist.json')), (err, result) => {
        if (err) {
            logger.writeMany(`[-] Failed to upload IP whitelist, err: ${err.message}.`, null, null, ['error', 'trace']);
        } else {
            logger.trace("[-] IP whitelist saved in memory.");
        }
    });
}

// Export 
const hookSetObject = (_redis, _mysql, _logger) => {
    logger = _logger;
    redis = _redis;
    mysql = _mysql;
}
module.exports = { hook, hookSetObject };
