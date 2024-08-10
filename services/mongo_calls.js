const { MongoClient, Logger } = require("mongodb");
const config = require('config');
const moment = require('moment');

const logger = require('../include/logger');

const mongodb_config = config.get('mongo_config');
const app_params = config.get('app');
const default_params = config.get('default');

async function connect_mongo(method, timestamp) {
    logger.trace(`[${timestamp}] Calling mongo (${method})...`);
    let client = new MongoClient(mongodb_config.uri);
    await client.connect();
    return [client.db(mongodb_config.db), client];
}
async function disconnect_mongo(client, method, timestamp) {
    await client.close();
    logger.trace(`[${timestamp}] Mongo closed (${method}).`);
}

exports.addUser = async(_username, _clientkey, _clientsecret, _metadata, req_timestamp, status) => {
    let client = null;
    try {
        let [database, _client] = await connect_mongo('addUser', req_timestamp);
        client = _client;
        let users = database.collection("users");
        let newuser = {
            username: _username,
            clientkey: _clientkey,
            clientsecret: _clientsecret,
            user_params: app_params.newuser_default,
            matadata: _metadata,
            timestamp: moment().format(default_params.log_date_format)
        }
        let result = await users.insertOne(newuser);
        if (result && result.insertedId) {
            status(null, result.insertedId);
        } else {
            status('Insert Failed', null);
        }
    } catch (err) {
        status(err.message, null);
    } finally {
        await disconnect_mongo(client, 'addUser', req_timestamp);
    }
}

exports.verifyUser = async(_username, req_timestamp, status) => {
    let client = null;
    try {
        let [database, _client] = await connect_mongo('verifyUser', req_timestamp);
        client = _client;
        let users = database.collection("users");
        const query = { username: _username };
        const options = {};
        let result = await users.findOne(query, options);
        if (result && result._id) {
            //delete result._id;
            //delete result.matadata;
            status(null, result);
        } else {
            status('Record Not Found', null);
        }
    } catch (err) {
        status(err.message, null);
    } finally {
        await disconnect_mongo(client, 'verifyUser', req_timestamp);
    }
}

exports.verifyClientKey = async(_clientkey, req_timestamp, status) => {
    let client = null;
    try {
        let [database, _client] = await connect_mongo('verifyClientKey', req_timestamp);
        client = _client;
        let users = database.collection("users");
        const query = { clientkey: _clientkey };
        const options = {};
        let result = await users.findOne(query, options);
        if (result && result._id) {
            //delete result._id;
            //delete result.matadata;
            status(null, result);
        } else {
            status('Record Not Found', null);
        }
    } catch (err) {
        status(err.message, null);
    } finally {
        await disconnect_mongo(client, 'verifyClientKey', req_timestamp);
    }
}

exports.fetchLastToken = async(_username, req_timestamp, status) => {
    let client = null;
    try {
        let [database, _client] = await connect_mongo('fetchLastToken', req_timestamp);
        client = _client;
        let tokens = database.collection("tokens");
        const query = { username: _username };
        const options = { sort: { $natural: -1 }, limit: 1 };
        let result = await tokens.findOne(query, options);
        if (result && result._id) {
            //delete result._id;
            status(null, result);
        } else {
            status('Record Not Found', null);
        }
    } catch (err) {
        status(err.message, null);
    } finally {
        await disconnect_mongo(client, 'fetchLastToken', req_timestamp);
    }
}

exports.addToken = async(_username, _jwt, _validity, _expiry, now, _metadata, req_timestamp, status) => {
    let client = null;
    try {
        let [database, _client] = await connect_mongo('addToken', req_timestamp);
        client = _client;
        let tokens = database.collection("tokens");
        let newtoken = {
            username: _username,
            jwt: _jwt,
            validity: _validity,
            expiry: _expiry,
            matadata: _metadata,
            timestamp: moment(now).format(default_params.log_date_format)
        }
        let result = await tokens.insertOne(newtoken);
        if (result && result.insertedId) {
            status(null, result.insertedId);
        } else {
            status('Insert Failed', null);
        }
    } catch (err) {
        status(err.message, null);
    } finally {
        await disconnect_mongo(client, 'addToken', req_timestamp);
    }
}