
const mysql2 = require('mysql2/promise');
const config = require('config');
const moment = require('moment');

const mysql_config = config.get('mysql_config');
const default_params = config.get('default');

let logger = null;

const mysql = () => { };

async function connect_mysql(method, timestamp) {
    if (default_params.DEBUG) logger.trace(`[${timestamp}] Calling maria (${method})...`);
    let con = await mysql2.createConnection(mysql_config);
    return con;
}

async function disconnect_mysql(con, method, timestamp) {
    if (con)
        await con.end();
    if (default_params.DEBUG) logger.trace(`[${timestamp}] Maria closed (${method}).`);
}

mysql.testConnection = async (status) => {
    let con = null;
    try {
        con = await connect_mysql('test', '-');
        let [rows, fields] = await con.execute('SELECT 1 FROM users;');
        status(null, rows);
    } catch (err) {
        status(err, null);
    } finally {
        await disconnect_mysql(con, 'test', '-');
    }
}

mysql.addUser = async (username, clientid, clientkey, clientsecret, applications, connections, scripts_total, token_validity, metadata, req_timestamp, status) => {
    let con = null;
    try {
        con = await connect_mysql('addUser', req_timestamp);
        await con.beginTransaction();
        let [result, rows] = await con.query('INSERT INTO users (username, clientid, clientkey, clientsecret, metadata) VALUES (?, ?, ?, ?, ?);', [username, clientid, clientkey, clientsecret, metadata]);
        if (result && result.affectedRows) {
            let values = applications.map(app => { return [app, username, connections, scripts_total, token_validity]; })
            let [result1, rows1] = await con.query('INSERT INTO applications (application, username, connections, scripts, token_validity) VALUES ?;', [values]);
            if (result1 && result1.affectedRows) {
                await con.commit();
                status(null, result1.affectedRows);
            } else {
                await con.rollback();
                status('Application Insert Failed', null);
            }
        } else {
            await con.rollback();
            status('User Insert Failed', null);
        }
    } catch (err) {
        logger.writeMany(`[${req_timestamp}] ${JSON.stringify(err)}`, null, null, ['error', 'trace']);
        status(err.message, null);
    } finally {
        await disconnect_mysql(con, 'addUser', req_timestamp);
    }
}

mysql.verifyUser = async (username, req_timestamp, status) => {
    let con = null;
    try {
        con = await connect_mysql('verifyUser', req_timestamp);
        let [rows, fields] = await con.execute('SELECT * FROM users WHERE username = ?;', [username]);
        if (rows && rows.length > 0) {
            //delete rows[0].id;
            //delete rows[0].matadata;
            status(null, rows[0]);
        } else {
            status('USER_NOT_FOUND', null);
        }
    } catch (err) {
        logger.writeMany(`[${req_timestamp}] ${JSON.stringify(err)}`, null, null, ['error', 'trace']);
        status(err.message, null);
    } finally {
        await disconnect_mysql(con, 'verifyUser', req_timestamp);
    }
}

mysql.verifyClientKey = async (clientkey, req_timestamp, status) => {
    let con = null;
    try {
        con = await connect_mysql('verifyClientKey', req_timestamp);
        let [rows, fields] = await con.execute('SELECT * FROM users WHERE clientkey = ?;', [clientkey]);
        if (rows && rows.length > 0) {
            //delete rows[0].id;
            //delete rows[0].matadata;
            status(null, rows[0]);
        } else {
            status('ClientKey Not Found', null);
        }
    } catch (err) {
        logger.writeMany(`[${req_timestamp}] ${JSON.stringify(err)}`, null, null, ['error', 'trace']);
        status(err.message, null);
    } finally {
        await disconnect_mysql(con, 'verifyClientKey', req_timestamp);
    }
}

mysql.verifyApplication = async (username, application, req_timestamp, status) => {
    let con = null;
    try {
        con = await connect_mysql('verifyApplication', req_timestamp);
        let [rows, fields] = await con.execute('SELECT * FROM applications WHERE username = ? AND application = ?;', [username, application]);
        if (rows && rows.length > 0) {
            //delete rows[0].id;
            status(null, rows[0]);
        } else {
            status('APP_NOT_FOUND', null);
        }
    } catch (err) {
        logger.writeMany(`[${req_timestamp}] ${JSON.stringify(err)}`, null, null, ['error', 'trace']);
        status(err.message, null);
    } finally {
        await disconnect_mysql(con, 'verifyApplication', req_timestamp);
    }
}

mysql.verifyUserDetails = async (username, application, req_timestamp, status) => {
    let con = null;
    try {
        con = await connect_mysql('verifyUserDetails', req_timestamp);
        let [rows, fields] = await con.execute('SELECT u.username, u.clientid, u.`status` user_stat, a.connections, a.scripts, a.token_validity, a.application, a.`status` app_stat, a.ips FROM users u JOIN applications a ON u.username = a.username WHERE u.username = ? AND a.application = ?;', [username, application]);
        if (rows && rows.length > 0) {
            //delete rows[0].id;
            status(null, rows[0]);
        } else {
            status('USER_NOT_FOUND', null);
        }
    } catch (err) {
        logger.writeMany(`[${req_timestamp}] error: ${err.message}`, null, null, ['error', 'trace']);
        status(err.message, null);
    } finally {
        await disconnect_mysql(con, 'verifyUserDetails', req_timestamp);
    }
}

mysql.verifyTokenDetails = async (_tokenid, req_timestamp, status) => {
    let con = null;
    try {
        con = await connect_mysql('verifyTokenDetails', req_timestamp);
        let [rows, fields] = await con.execute('SELECT * FROM tokens WHERE tokenid = ? LIMIT 1;', [_tokenid]);
        if (rows && rows.length > 0) {
            //delete rows[0].id;
            //delete rows[0].matadata;
            status(null, rows[0]);
        } else {
            status('TOKEN_NOT_FOUND', null);
        }
    } catch (err) {
        logger.writeMany(`[${req_timestamp}] ${JSON.stringify(err)}`, null, null, ['error', 'trace']);
        status(err.message, null);
    } finally {
        await disconnect_mysql(con, 'verifyTokenDetails', req_timestamp);
    }
}

mysql.fetchLastToken = async (_username, application, _scope, req_timestamp, status) => {
    let con = null;
    try {
        con = await connect_mysql('fetchLastToken', req_timestamp);
        let [rows, fields] = await con.execute('SELECT * FROM tokens WHERE username = ? AND application = ? AND scope = ? AND status = 1 ORDER BY id DESC LIMIT 1;', [_username, application, _scope]);
        if (rows && rows.length > 0) {
            //delete rows[0].id;
            //delete rows[0].matadata;
            status(null, rows[0]);
        } else {
            status('TOKEN_NOT_FOUND', null);
        }
    } catch (err) {
        logger.writeMany(`[${req_timestamp}] ${JSON.stringify(err)}`, null, null, ['error', 'trace']);
        status(err.message, null);
    } finally {
        await disconnect_mysql(con, 'fetchLastToken', req_timestamp);
    }
}

mysql.addToken = async (tokenid, _username, _application, _jwt, _validity, _expiry, _scope, now, _metadata, req_timestamp, status) => {
    let con = null;
    try {
        con = await connect_mysql('addToken', req_timestamp);
        let [result, rows] = await con.query('INSERT INTO tokens (tokenid, username, application, jwt, validity, expiry, scope, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?);', [tokenid, _username, _application, _jwt, _validity, _expiry, _scope, _metadata]);
        if (result && result.affectedRows) {
            status(null, result.affectedRows);
        } else {
            status('Token Insert Failed', null);
        }
    } catch (err) {
        logger.writeMany(`[${req_timestamp}] ${JSON.stringify(err)}`, null, null, ['error', 'trace']);
        status(err.message, null);
    } finally {
        await disconnect_mysql(con, 'addToken', req_timestamp);
    }
}

mysql.removeToken = async (metadata2, tokenid, req_timestamp, status) => {
    let con = null;
    try {
        con = await connect_mysql('removeToken', req_timestamp);
        let [result, rows] = await con.query('UPDATE `tokens` SET `metadata2` = ?, `status` = ? WHERE `tokenid` = ?', [metadata2, moment().unix(), tokenid]);
        if (result && result.affectedRows) {
            status(null, result.affectedRows);
        } else {
            status('Token Update Failed', null);
        }
    } catch (err) {
        logger.writeMany(`[${req_timestamp}] ${JSON.stringify(err)}`, null, null, ['error', 'trace']);
        status(err.message, null);
    } finally {
        await disconnect_mysql(con, 'removeToken', req_timestamp);
    }
}

const mysqlSetObject = (_logger) => {
    logger = _logger;
}
module.exports = { mysql, mysqlSetObject };
