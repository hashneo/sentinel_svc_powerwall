'use strict';
require('array.prototype.find');

function _module(config) {

    if ( !(this instanceof _module) ){
        return new _module(config);
    }

    const redis = require('redis');
    var moment = require('moment');

    let pub = redis.createClient(
        {
            host: process.env.REDIS || global.config.redis || '127.0.0.1' ,
            socket_keepalive: true,
            retry_unfulfilled_commands: true
        }
    );

    const logger = require('sentinel-common').logger;
    
    pub.on('end', function(e){
        logger.info('Redis hung up, committing suicide');
        process.exit(1);
    });

    var NodeCache = require( "node-cache" );

    var deviceCache = new NodeCache();
    var statusCache = new NodeCache();

    var merge = require('deepmerge');

    var request = require('request');
    var https = require('https');

    const mysql = require('./mysql');

    var keepAliveAgent = new https.Agent({ keepAlive: true });
/*
    require('request').debug = true
    require('request-debug')(request);
*/

    process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = 0;

    deviceCache.on( 'set', function( key, value ){
        let data = JSON.stringify( { module: global.moduleName, id : key, value : value });
        logger.debug( 'sentinel.device.insert => ' + data );
        pub.publish( 'sentinel.device.insert', data);
    });

    deviceCache.on( 'delete', function( key ){
        let data = JSON.stringify( { module: global.moduleName, id : key });
        logger.debug( 'sentinel.device.delete => ' + data );
        pub.publish( 'sentinel.device.delete', data);
    });

    statusCache.on( 'set', function( key, value ){
        let data = JSON.stringify( { module: global.moduleName, id : key, value : value });
        logger.debug( 'sentinel.device.update => ' + data );
        pub.publish( 'sentinel.device.update', data);
    });

	var that = this;

    function call(url) {

        return new Promise( (fulfill, reject) => {

            logger.trace(url);

            let options = {
                url : 'https://' + config.gateway.ip + '/api/' + url,
                timeout : 90000,
                agent: keepAliveAgent
            };

            try {
                request(options, (err, response, body) => {
                    if (!err && response.statusCode == 200) {
                        fulfill(JSON.parse(body));
                    } else {
                        logger.error(err||body);
                        reject(err||body);
                    }
                });
            }catch(e){
                logger.error(err);
                reject(e);
            }
        } );
    }

    this.getDevices = () => {

        return new Promise( (fulfill, reject) => {
            deviceCache.keys( ( err, ids ) => {
                if (err)
                    return reject(err);

                deviceCache.mget( ids, (err,values) =>{
                    if (err)
                        return reject(err);

                    statusCache.mget( ids, (err, statuses) => {
                        if (err)
                            return reject(err);

                        let data = [];

                        for (let key in values) {
                            let v = values[key];

                            if ( statuses[key] ) {
                                v.current = statuses[key];
                                data.push(v);
                            }
                        }

                        fulfill(data);
                    });

                });
            });
        });
    };

    this.getDeviceStatus = (id) => {

        return new Promise( (fulfill, reject) => {
            try {
                statusCache.get(id, (err, value) => {
                    if (err)
                        return reject(err);

                    fulfill(value);
                }, true);
            }catch(err){
                reject(err);
            }
        });

    };

    function updateStatus() {
        return new Promise( ( fulfill, reject ) => {

            let s = {};
            s['id'] = config.gateway.id;
            call('sitemaster')
                .then((status) => {
                    s['running'] = status.running;
                    s['connected'] = s.connected_to_tesla;
                    return call('meters/aggregates');
                })
                .then((status) => {

                    s['current'] = {
                        updated: moment(status.battery.last_communication_time).format(),
                        grid: {
                            imported: status.site.energy_imported,
                            exported: status.site.energy_exported,
                            current: status.site.instant_power
                        },
                        battery: {
                            imported: status.battery.energy_imported,
                            exported: status.battery.energy_exported,
                            current: status.battery.instant_power
                        },
                        solar: {
                            exported: status.solar.energy_exported,
                            current: status.solar.instant_power
                        },
                        demand: {
                            imported: status.load.energy_imported,
                            current: status.load.instant_power
                        }
                    };

                    return call('system_status/grid_status')
                })
                .then((status) => {
                    s.current.grid['active'] = status.grid_status === 'SystemGridConnected';
                    return call('system_status/soe')
                })
                .then((status) => {
                    s.current.battery['level'] = status.percentage;

                    statusCache.set(s.id, s.current);
                    fulfill([s]);
                })
                .catch((err) => {
                    reject(err);
                });

        });
    }

    this.Reload = () => {
        return new Promise( (fulfill,reject) => {
            fulfill([]);
        });
    };

    function loadSystem(){
        return new Promise( ( fulfill, reject ) => {

            logger.info("Loading System");

            var deviceStatus;

            global.schema = config.db.schema || 'sentinel';

            call('site_info')
                .then((info) => {

                    let d = {};

                    d['name'] = info.site_name;
                    d['id'] = config.gateway.id;
                    d['type'] = 'energy.gateway';
                    d['current'] = {};
                    d['location'] = {};
                    d['location']['timezone'] = {};
                    d['location']['timezone']['name'] = info.timezone;

                    deviceCache.set(d.id, d);

                    fulfill([d]);
                })
                .catch((err) => {
                    reject(err);
                });
        });

    }

    loadSystem()

        .then( () =>{
            return updateStatus();
        })
        .then( () => {

            function pollSystem() {
                updateStatus()
                    .then(() => {
                        setTimeout(pollSystem, 5000);
                    })
                    .catch((err) => {
                        logger.error(err);
                        setTimeout(pollSystem, 60000);
                    });

            }

            setTimeout(pollSystem, 5000);

        })
        .catch((err) => {
            logger.error(err);
            process.exit(1);
        });

    return this;
}

module.exports = _module;