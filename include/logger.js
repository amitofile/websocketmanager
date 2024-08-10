
// Load global modules
const config = require('config');
const fs = require('fs');
const moment = require('moment');

// Set few configurations
const params = config.get('default');
const format = params.log_date_format.split(' ');

const file_names = {
    'e': 'error.log',
    'w': 'warning.log',
    'i': 'info.log',
    't': 'trace.log'
};

const logger = function () { };

let instanceId = null, appId = null;

logger.writeMany = (msg, stackTrace, fields, modes = ['trace']) => {
    let now = moment();
    if (modes) {
        for (let type in modes) {
            baseLogger(instanceId, appId, modes[type], now, msg, fields, stackTrace);
        }
    }
    switch (modes[0]) {
        case 'error':
            if (params.log_on_consol && params.log_mode.includes('ERROR'))
                console.log('\x1b[31m%s\x1b[0m', `[${now.format(format[1])}][EROR]${msg}`);
            break;
        case 'warning':
            if (params.log_on_consol && params.log_mode.includes('WARNING'))
                console.log('\x1b[33m%s\x1b[0m', `[${now.format(format[1])}][WARN]${msg}`);
            break;
        case 'info':
            if (params.log_on_consol && params.log_mode.includes('INFO'))
                console.log('\x1b[36m%s\x1b[0m', `[${now.format(format[1])}][INFO]${msg}`);
            break;
        case 'trace':
            if (params.log_on_consol && params.log_mode.includes('TRACE'))
                console.log('\x1b[32m%s\x1b[0m', `[${now.format(format[1])}][TRAC]${msg}`);
            break;
    }
};

logger.write = (msg, stackTrace, fields, type = 'trace') => {
    let now = moment();
    baseLogger(instanceId, appId, type, now, msg, fields, stackTrace);
    if (params.log_on_consol && params.log_mode.includes(type.toUpperCase))
        console.log('\x1b[33m%s\x1b[0m', `[${now.format(format[1])}][${type}]${msg}`);
};

logger.error = (msg, stackTrace, fields) => {
    let now = moment();
    baseLogger(instanceId, appId, 'error', now, msg, fields, stackTrace);
    if (params.log_on_consol && params.log_mode.includes('ERROR'))
        console.log('\x1b[31m%s\x1b[0m', `[${now.format(format[1])}][EROR]${msg}`);
};

logger.warning = (msg, stackTrace, fields) => {
    let now = moment();
    baseLogger(instanceId, appId, 'warning', now, msg, fields, stackTrace);
    if (params.log_on_consol && params.log_mode.includes('WARNING'))
        console.log('\x1b[33m%s\x1b[0m', `[${now.format(format[1])}][WARN]${msg}`);
};

logger.info = (msg, stackTrace, fields) => {
    let now = moment();
    baseLogger(instanceId, appId, 'info', now, msg, fields, stackTrace);
    if (params.log_on_consol && params.log_mode.includes('INFO'))
        console.log('\x1b[36m%s\x1b[0m', `[${now.format(format[1])}][INFO]${msg}`);
};

logger.trace = (msg, stackTrace, fields) => {
    let now = moment();
    baseLogger(instanceId, appId, 'trace', now, msg, fields, stackTrace);
    if (params.log_on_consol && params.log_mode.includes('TRACE'))
        console.log('\x1b[32m%s\x1b[0m', `[${now.format(format[1])}][TRAC]${msg}`);
};

function baseLogger(instanceId, appId, type, now, msg, fields, stackTrace) {
    let dir = params.log_path;
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    let singleFile;

    if (typeof (params.log_mode) !== undefined || params.log_mode != '') {
        if (!params.log_rotate) {
            singleFile = `/${appId}/${instanceId}/${now.format(format[0])}_all.log`;
        } else {
            dir = dir + `/${now.format(format[0])}/${appId}/${instanceId}/`;
        }
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    }

    if (typeof msg === 'object' || typeof msg === 'array') {
        msg = JSON.stringify(msg);
    }

    let string;
    switch (type) {
        case 'error':
            if (params.log_mode.includes('ERROR')) {
                string = "";
                string += `[${now.format(format[1])}][ERROR]`;
                string += msg;
                for (var item in fields) {
                    if (fields.hasOwnProperty(item)) {
                        string += `|${item.toString().toUpperCase()}: ${fields[item]}`;
                    }
                }
                if (stackTrace != undefined && stackTrace != '' && stackTrace.hasOwnProperty(0)) {
                    string += `|Error at: ${stackTrace[0].getFileName()} ${stackTrace[0].getLineNumber()}:${stackTrace[0].getColumnNumber()}`;
                }
                fs.appendFile(dir + (!params.log_rotate ? singleFile : file_names.e), `${string}\n`, (err) => {
                    if (err)
                        console.log('\x1b[31m%s\x1b[0m', err);
                });
            }
            break;
        case 'warning':
            if (params.log_mode.includes('WARNING')) {
                string = "";
                string += `[${now.format(format[1])}][WARNING]`;
                string += msg;
                for (var item in fields) {
                    if (fields.hasOwnProperty(item)) {
                        string += `|${item.toString().toUpperCase()}: ${fields[item]}`;
                    }
                }
                fs.appendFile(dir + (!params.log_rotate ? singleFile : file_names.w), `${string}\n`, (err) => {
                    if (err)
                        console.log('\x1b[33m%s\x1b[0m', err);
                });
            }
            break;
        case 'info':
            if (params.log_mode.includes('INFO')) {
                string = "";
                string += `[${now.format(format[1])}][INFO]`;
                string += msg;
                for (var item in fields) {
                    if (fields.hasOwnProperty(item)) {
                        string += `|${item.toString().toUpperCase()}: ${fields[item]}`;
                    }
                }
                fs.appendFile(dir + (!params.log_rotate ? singleFile : file_names.i), `${string}\n`, (err) => {
                    if (err)
                        console.log('\x1b[36m%s\x1b[0m', err);
                });
            }
            break;
        case 'trace':
            if (params.log_mode.includes('TRACE')) {
                string = "";
                string += `[${now.format(format[1])}][TRACE]`;
                string += msg;
                for (var item in fields) {
                    if (fields.hasOwnProperty(item)) {
                        string += `|${item.toString().toUpperCase()}: ${fields[item]}`;
                    }
                }
                fs.appendFile(dir + (!params.log_rotate ? singleFile : file_names.t), `${string}\n`, (err) => {
                    if (err)
                        console.log('\x1b[32m%s\x1b[0m', err);
                });
            }
            break;
    }
}

// Export 
const loggerSetObject = (_instanceId, _appId) => {
    instanceId = _instanceId;
    appId = _appId;
}
module.exports = { logger, loggerSetObject };
