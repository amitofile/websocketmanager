const config = require('config');
const jwt = require('jsonwebtoken');
const url = require('url');
const crypto = require('crypto');

const default_params = config.get('default');
const app_params = config.get('app');
let redis = null, logger = null;

const _function = () => { };

_function.setResult = (req, res, result, code) => {
    try {
        let _code = code || default_params.default_success_code;
        res.setHeader('Content-Type', default_params.default_content_type);
        let _result = { "status": "success", "result": result };
        logger.writeMany(`[${req.timestamp}] Response [${_code}]: ${JSON.stringify(_result)}`, null, null, ['info', 'trace']);
        return res
            .status(_code)
            .json(_result)
            .end();
    } catch (error) {
        let __error = { "status": "error", "result": "Operation failed", "timestamp": req.timestamp };
        logger.writeMany(`[${req.timestamp}] Response 503: ${JSON.stringify(__error)}, setResult err: ${error.message}`, null, null, ['error', 'trace']);
        return res
            .status(503)
            .json(__error)
            .end();
    }
}

_function.setError = (req, res, client_msg, log_msg, bot_test = null, code) => {
    try {
        let _code = code || default_params.default_error_code;
        res.setHeader('Content-Type', default_params.default_content_type);
        let _error = null;
        if (client_msg) {
            _error = client_msg;
        } else {
            _error = "Operation failed";
        }
        if (log_msg) {
            logger.writeMany(`[${req.timestamp}] ${log_msg}`, null, null, ['error', 'trace']);
            redis.addFault(_error, log_msg, req);
        }
        if (bot_test) {
            //update ip hit stats
            redis.incrementStatVal(`bottest:${req.headers._ip}`, (err0, new_count) => {
                if (err0)
                    logger.writeMany(`[${req.timestamp}] Failed to increment ip hit count, err: ${err0.message}`, null, null, ['error', 'trace']);
            });
        }
        let __error = { "status": "error", "result": _error, "timestamp": req.timestamp };
        logger.writeMany(`[${req.timestamp}] Response [${_code}]: ${JSON.stringify(__error)}`, null, null, ['error', 'trace']);
        return res
            .status(_code)
            .json(__error)
            .end();
    } catch (error) {
        let __error = { "status": "error", "result": "Operation failed", "timestamp": req.timestamp };
        logger.writeMany(`[${req.timestamp}] Response 503: ${JSON.stringify(__error)}, setError err: ${error.message}`, null, null, ['error', 'trace']);
        return res
            .status(503)
            .json(__error)
            .end();
    }
}

_function.checkCredentials = (clientkey, clientsecret, status) => {
    if (typeof clientkey === "string" && typeof clientsecret === "string" && clientkey.length >= 16 && clientsecret.length >= 16) {
        status(true);
    } else {
        status(false);
    }
}

_function.generateAccessToken = (payload, expiry) => {
    //payload = encrypt(JSON.stringify(payload));
    let _payload = { data: payload };
    return jwt.sign(_payload, app_params.jwt_secret, { expiresIn: 60 * (expiry || app_params.newuser_default.token_validity) });
}

_function.checkAccessToken = (req, status) => {
    try {
        logger.trace(`[${req.timestamp}] Looking for access details...`);
        let access_token = null;
        if (req.headers.authorization) {
            access_token = req.headers.authorization.split(' ')[1];
        } else {
            let urlpart = url.parse(req.url, true);
            if (urlpart.query && urlpart.query.access_token) {
                access_token = urlpart.query.access_token;
            }
        }
        if (access_token) {
            let _access_token = access_token.split('.');
            if (_access_token[1]) {
                let __access_token = Buffer.from(_access_token[1], 'base64').toString();
                logger.writeMany(`[${req.timestamp}] Access token data: ${__access_token}`, null, null, ['info', 'trace']);
                verifyAccessToken(access_token, req.timestamp, data => {
                    if (data) {
                        status(data);
                    } else {
                        logger.writeMany(`[${req.timestamp}] Faile to verify access token. [Token: ${access_token}]`, null, null, ['error', 'trace']);
                        status(false);
                    }
                });
            } else {
                logger.writeMany(`[${req.timestamp}] Invalid access token: ${access_token}`, null, null, ['error', 'trace']);
                status(false);
            }
        } else {
            logger.writeMany(`[${req.timestamp}] Access token not found.`, null, null, ['error', 'trace']);
            status(false);
        }
    } catch (error) {
        logger.writeMany(`[${req.timestamp}] checkAccessToken err: ${error.message}`, null, null, ['error', 'trace']);
        status(false);
    }
}

_function.grabMetadata = (req) => {
    let metadata = {};
    metadata.headers = req.headers;
    metadata.ip = req.ips && req.ips.length !== 0 ? req.ips : req.ip;
    return metadata;
}

function verifyAccessToken(token, timestamp, status) {
    try {
        jwt.verify(token, app_params.jwt_secret, (err, decoded) => {
            if (err) {
                status(false);
            } else {
                if (decoded) {
                    if (decoded.data) {
                        //let data = JSON.parse(decrypt(decoded.data));
                        let data = decoded.data;
                        data.exp = decoded.exp || app_params.newuser_default.token_validity;
                        if (data.username && data.application) {
                            status(data);
                        } else {
                            status(false);
                        }
                    } else {
                        status(false);
                    }
                } else {
                    status(false);
                }
            }
        });
    } catch (error) {
        logger.writeMany(`[${timestamp}] verifyAccessToken err: ${error.message}`, null, null, ['error', 'trace']);
        status(false);
    }
}

function encrypt(text) {
    let cipher = crypto.createCipheriv(app_params.crypto_algo, Buffer.from(app_params.crypto_key), app_params.crypto_iv);
    let encrypted = cipher.update(text);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    return encrypted.toString('hex');
}

function decrypt(etext) {
    let encryptedText = Buffer.from(etext, 'hex');
    let decipher = crypto.createDecipheriv(app_params.crypto_algo, Buffer.from(app_params.crypto_key), app_params.crypto_iv);
    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString();
}

// Export 
const functionSetObject = (_redis, _logger) => {
    redis = _redis;
    logger = _logger;
}
module.exports = { _function, functionSetObject };