const axios = require('axios');
const logger = require('../include/logger');

exports.verifyUser = (username, clientkey, clientsecret, timestamp, status) => {
    axios.get('https://tradeapi.kotaksecurities.com/apim/dev/1.0/get-application?clientKey=' + clientkey)
        .then(function(data) {
            let _data = JSON.parse(JSON.stringify(data));
            if (_data.status == 'SUCCESS' && _data.result[0] && _data.result[0]) {

            } else {
                logger.trace(`[${timestamp}] Error: Failed to verify user`);
                status(false);
            }
        })
        .catch(function(error) {
            logger.trace(`[${timestamp}] Error: ${error.message}`);
            status(false);
        });
}