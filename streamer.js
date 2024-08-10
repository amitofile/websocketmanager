const express = require("express");
const { createServer } = require("http");
const { Server } = require("socket.io");
const moment = require('moment');
const config = require('config');

const app = express();
const httpServer = createServer(app);
const default_params = config.get('default');
const app_params = config.get('app');

const env = process.env.NODE_ENV || default_params.ENV;
const _ip = env == "development" ? '127.0.0.1' : JSON.parse(require('fs').readFileSync('./config/node.json')).id;
const nodeId = _ip.replaceAll('.', '');
const instanceId = `INST${nodeId}${process.pid}`;
const appId = 'fault';

const { logger, loggerSetObject } = require('./include/logger');
loggerSetObject(instanceId, appId);
const { RedisPool, redisPoolSetObject } = require('./include/redis_pool');
redisPoolSetObject(logger);

const io_fault0 = new Server(httpServer, { path: "/fault0" });
io_fault0.on("connection", (socket) => {
    let timestamp = socket.handshake.headers.etimestamp || '-';
    logger.writeMany(`[${timestamp}] Client connected [socketId: ${socket.id}, sessionId: ${socket.handshake.headers.uuid || '-'}] [Fault0]`, null, null, ['warning', 'trace']);
    socket.emit('broadcast', `Welcome to ${default_params.application} (Build: ${default_params.BUILD}).`);
    socket.emit('broadcast', `You are connected to test feed. This feed will be auto terminated in 60 seconds.`);

    /*
    socket.on("sample", (arg1) => {
        switch (arg1) {
            case "price-feed":
                socket.emit('broadcast', ``);
                break;
            case "price-feed-jason":
                socket.emit('broadcast', ``);
                break;
            case "market-feed":
                socket.emit('broadcast', ``);
                break;
            case "market-feed-jason":
                socket.emit('broadcast', ``);
                break;
            case "indice-feed":
                socket.emit('broadcast', ``);
                break;
            case "indice-feed-jason":
                socket.emit('broadcast', ``);
                break;
            case "order-feed":
                socket.emit('broadcast', ``);
                break;
            default:
                break;
        }
    });
    */
    socket.on("handshake", (arg1) => {
        socket.emit('broadcast', `Received: ${arg1}`);
    });

    let i_am_alive = setTimeout(() => {
        logger.writeMany(`[${timestamp}] Test feed terminated in 60 seconds [socketId: ${socket.id}, sessionId: ${socket.handshake.headers.uuid || '-'}] [Fault0]`, null, null, ['warning', 'trace']);
        socket.emit('broadcast', `Please refer websocket document at https://amitofile.in/marketlive/ for more details.`);
        socket.disconnect();
    }, 60000);

    socket.on('disconnect', () => {
        logger.writeMany(`[${timestamp}] Client disconnected [socketId: ${socket.id}, sessionId: ${socket.handshake.headers.uuid || '-'}] [Fault0]`, null, null, ['warning', 'trace']);
        clearTimeout(i_am_alive);
    });
});

const io_faultn = new Server(httpServer, { path: "/faultn" });
io_faultn.on("connection", (socket) => {
    let timestamp = socket.handshake.headers.etimestamp || '-';
    let errormessage = socket.handshake.headers.errormessage || 'Session Failed - Internal communication issue';
    logger.trace(`[${timestamp}] Client connected [socketId: ${socket.id}, sessionId: ${socket.handshake.headers.uuid || '-'}]`);
    socket.on('disconnect', () => {
        logger.writeMany(`[${timestamp}] Client disconnected [socketId: ${socket.id}, sessionId: ${socket.handshake.headers.uuid || '-'}], ${errormessage}`, null, null, ['error', 'trace']);
    });
    socket.emit('broadcast', `${errormessage} [timestamp-${timestamp}]`);
    socket.disconnect();
});

let a = false;
let _streamer = httpServer.listen(app_params.fault_stremr_port, () => {
    logger.trace(`[-] Fault streamer (instance) started in ${env} mode at http://${_streamer.address().address}:${_streamer.address().port} @${process.pid}`);
    const redisObj = new RedisPool(instanceId, appId, nodeId, config.get('redis_config').db.feeder_status, 'w', 1);
    let feed_test = setInterval(() => {
        redisObj.set(`FS:${_ip}:${app_params.fault_stremr_port}`, moment().format(default_params.log_date_format), 'EX', app_params.TTL_CHECK + 1, (err) => {
            if (err) {
                logger.writeMany(`[-] Failed to save status for feeder ${_ip}:${app_params.fault_stremr_port}`, null, null, ['error', 'trace']);
                return;
            }
            if (!a) {
                logger.trace('[-] Streamer is ready...');
                a = true;
            }
        });
    }, app_params.TTL_CHECK * 1000);
});

httpServer.on('error', (err) => {
    console.log(err.code);
});
