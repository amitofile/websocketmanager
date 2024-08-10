
const config = require('config');

const app_params = config.get('app');

let __function = null, logger = null;

const check = function () { };
check.registrationToken = (req, res, next) => {
    logger.trace(`[${req.timestamp}] Authenticating request...`);
    if (req.headers.authorization && req.headers.authorization == app_params.registration_token) {
        logger.trace(`[${req.timestamp}] Registration token found.`);
        delete req.headers.authorization;
        next();
    } else {
        __function.setError(req, res, "You are not authorized to access this content", `Authorization header/registration token is invalid or unavailable`, true, 401);
    }
}

check.verificationToken = (req, res, next) => {
    logger.trace(`[${req.timestamp}] Authenticating request...`);
    if (req.headers.authorization && req.headers.authorization == app_params.verification_token) {
        logger.trace(`[${req.timestamp}] Verification token found.`);
        delete req.headers.authorization;
        next();
    } else {
        __function.setError(req, res, "You are not authorized to access this content", `Authorization header/verification token is invalid or unavailable`, true, 401);
    }
}

check.credentials = (req, res, next) => {
    logger.trace(`[${req.timestamp}] Checking credentials...`);
    if (req.body.consumerKey && req.body.consumerSecret) {
        __function.checkCredentials(req.body.consumerKey, req.body.consumerSecret, status => {
            if (status) {
                logger.trace(`[${req.timestamp}] Credentials found.`);
                next();
            } else {
                __function.setError(req, res, "Client credentials invalid or unavailable", `Client credentials invalid or unavailable`, true, 401);
            }
        });
    } else {
        __function.setError(req, res, "Client credentials invalid or unavailable", `Client credentials invalid or unavailable`, true, 401);
    }
}

check.authorization = (req, res, next) => {
    logger.trace(`[${req.timestamp}] Checking authorization...`);
    if (req.headers && req.headers.authorization) {
        let _authorization = req.headers.authorization.split(' ')[1] || "";
        let credentials = Buffer.from(_authorization, "base64").toString("utf8").split(':');
        let clientkey = credentials[0];
        let clientsecret = credentials[1] || "";
        __function.checkCredentials(clientkey, clientsecret, status => {
            if (status) {
                logger.trace(`[${req.timestamp}] Credentials found.`);
                req.body.consumerKey = clientkey;
                req.body.consumerSecret = clientsecret;
                next();
            } else {
                __function.setError(req, res, "You are not authorized to access this content", `Authorization header is invalid or unavailable`, true, 401);
            }
        });
    } else {
        __function.setError(req, res, "You are not authorized to access this content", `Authorization header is invalid or unavailable`, true, 401);
    }
}

// Export 
const checkSetObject = (_function, _logger) => {
    __function = _function;
    logger = _logger;
}
module.exports = { check, checkSetObject };