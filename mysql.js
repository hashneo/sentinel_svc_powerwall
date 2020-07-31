'use strict';

function mysql(){

    const mysql = require('mysql');

    var connection = undefined;

    this.connect = (config) => {

        return new Promise( (fulfill, reject ) => {

            if (!config){
                config = {
                    host: 'localhost',
                    user: 'root',
                    password: 'bitnami'
                }
            }

            let c = mysql.createConnection({
                host: config.host,
                user: config.user,
                password: config.password
            });

            c.connect( (err)  => {
                if(err)
                    return reject(err);
                connection = c;
                console.log("mysql => We are connected");
                fulfill(this);
            });

            c.on('error', function(err) {

                if ( err === 'PROTOCOL_CONNECTION_LOST' ){

                }

                console.log('db error', err);
                throw err;
            });
        })

    };


    this.useDatabase = (name) => {

        return new Promise( (fulfill, reject ) => {
            connection.query(`use ${name};`, (err) => {
                if (err)
                    return reject(err);

                fulfill( new database(connection) );
            });

        });
    };
}

function database(_connection) {
    var connection = _connection;

    this.query = (q) => {
        return new Promise( (fulfill, reject) => {
            connection.query(q, (err, rows, fields) => {
                if (err){
                    reject(err);
                }else{
                    fulfill(rows,fields);
                }
            });
        });
    };

    this.select = (t, d) => {
        return new Promise( (fulfill, reject) => {
            let _f = [];
            let _p = [];
            Object.keys(d).forEach( (key) => {
                _f.push(key  +' = ?');
                _p.push(d[key]);
            });
            connection.query(`SELECT * FROM ${t} WHERE ${_f.join(' AND ')}`, _p, (err, rows, fields) => {
                if (err){
                    reject(err);
                }else{
                    fulfill(rows,fields);
                }
            });
        });
    };

    this.insert = (t, d) => {
        return new Promise( (fulfill, reject) => {
            let _f = [];
            let _q = [];
            let _p = [];
            Object.keys(d).forEach( (key) => {
                _f.push(key);
                _q.push('?');

                let _v = d[key];

                if (_v instanceof Date){
                    _v = _v.toISOString().replace(/T/, ' ').replace(/\..+/, '');
                }

                _p.push(_v);
            });

            if ( process.env.NOINSERT ){
                fulfill(0);
            }else {
                connection.query(`INSERT IGNORE INTO ${t} (${_f.join(', ')}) VALUES (${_q.join(', ')})`, _p, (err, result) => {
                    if (err) {
                        reject(err);
                    } else {
                        fulfill(result.insertId);
                    }
                });
            }
        });
    };

    this.beginTransaction = () => {
        return new Promise( (fulfill, reject) => {
            connection.beginTransaction( (err) =>{
                if (err){
                    reject(err);
                    return;
                }
                fulfill();
            })
        })
    };

    this.commit = () => {
        return new Promise( (fulfill, reject) => {
            connection.commit( (err) =>{
                if (err){
                    reject(err);
                    return;
                }
                fulfill();
            })
        })
    };

    this.rollback = () => {
        return new Promise( (fulfill, reject) => {
            connection.rollback( (err) =>{
                if (err){
                    reject(err);
                    return;
                }
                fulfill();
            })
        })
    };
}

module.exports = new mysql();