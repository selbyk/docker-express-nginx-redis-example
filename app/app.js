'use strict';
//console.log(process.env);
// Import
const assert = require('assert');
const _ = require('lodash');
const RedisClient = require('node-redis-client');
const express = require('express');
const hbs = require('express-handlebars');
const path = require('path');
const logger = require('morgan');
const bodyParser = require('body-parser');

const routes = require('./routes/index');
const helloWorld = require('./routes/hello­world');

const app = express();

// view engine setup
app.set('views', 'app/views/');
app.engine('.hbs', hbs({
  extname: '.hbs',
  defaultLayout: 'index',
  layoutsDir: 'app/views/',
  partialsDir: 'app/views/partials/'
}));
app.set('view engine', '.hbs');

let realtimeHits = {};
let sendStats = null;

const recordHit = (time, ip) => {
  if (!realtimeHits[ip]) {
    realtimeHits[ip] = [time];
  } else {
    realtimeHits[ip].push(time);
  }
  //console.log(realtimeHits);
};

// uncomment after placing your favicon in /public
//app.use(favicon(__dirname + '/public/favicon.ico'));
app.use(logger('dev'));
app.use((req, res, next) => {
  //console.log(req._startTime.valueOf());
  recordHit(req._startTime.valueOf(), req.ip);
  next();
});

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({
  extended: false
}));
app.use(express.static(path.join(__dirname, 'public')));

app.use('/', routes);
app.use('/hello-world', helloWorld);

app.use('/internal', (req, res, next) => {
  //console.log('omg its secret: ', req.get('x-internal-secret'));
  /* GET home page. */
  if (req.get('x-internal-secret') === 'secretlol') {
    next();
  } else {
    var err = new Error('Forbidden');
    err.status = 300;
    next(err);
  }
});

app.get('/internal', (req, res, next) => {
  /* GET home page. */
  if (sendStats) {
    sendStats(req, res);
  } else {
    var err = new Error('Sever Error');
    err.status = 500;
    next(err);
  }
});

// catch 404 and forward to error handler
app.use((req, res, next) => {
  var err = new Error('Not Found');
  err.status = 404;
  next(err);
});

// error handlers

// development error handler
// will print stacktrace
if (app.get('env') === 'development') {
  app.use((err, req, res, next) => {
    res.status(err.status || 500);
    res.render('error', {
      message: err.message,
      error: err
    });
  });
}

// production error handler
// no stacktraces leaked to user
app.use((err, req, res, next) => {
  res.status(err.status || 500);
  res.render('error', {
    message: err.message,
    error: {}
  });
});

const persistHits = (redisClient) => {
  const tmp = realtimeHits;
  realtimeHits = {};
  client.call('GET', 'hits', (err, result) => {
    const hits = JSON.parse(result);
    //console.log('redis', hits);
    let time = new Date();
    time.setDate(time.getMinutes() - 1);
    client.call('MULTI');
    client.call('SET', 'hits', JSON.stringify(_.chain(hits)
      .mergeWith(tmp, (objValue, srcValue) => {
        if (_.isArray(objValue)) {
          return objValue.concat(srcValue);
        } else {
          return [].concat(srcValue);
        }
      })
      .mapValues(function(o) {
        return o.slice(_.sortedIndex(0, time));
      })
      .value()));
    client.call('GET', 'hits');
    client.call('EXEC', (error, results) => {
      //console.log('error redis', error);
      const hits = JSON.parse(results[1]);
      //console.log('new redis', hits);
      client.call('SET', 'hitsPerMinute', JSON.stringify(_.chain(hits)
        .mapValues((value) => {
          return value.length;
        })
        .transform((result, numHits, ip) => {
          (result || (result = [])).push({
            ip,
            numHits
          });
        }, [])
        .orderBy('numHits', 'desc')
        .value()));
    });
  });
};
let persistInterval = null;
// Create client
const client = new RedisClient({
  host: process.env.DB_1_PORT_6379_TCP_ADDR,
  port: process.env.DB_1_PORT_6379_TCP_PORT
});
// Client connected to Redis
client.on('connect', function() {

  // Simple ping/pong with callback
  client.call('PING', (error, result) => {
    assert.equal(result, 'PONG');
  });

  // Multiple parameters with callback
  client.call('SET', 'hits', '{}', (error, result) => {
    assert.equal(result, 'OK');
  });

  client.call('SET', 'hitsPerMinute', '[]', (error, result) => {
    assert.equal(result, 'OK');
  });

  // Multi block with callback only on EXEC
  //client.call('MULTI');
  persistInterval = setInterval(persistHits, 5000, client);

  sendStats = (req, res) => {
    client.call('GET', 'hitsPerMinute', (error, result) => {
      //console.log(result);
      const hitsPerMinute = JSON.parse(result);
      if (error) {
        res.render('error', {
          message: 'Houston, we have a problem.',
          error
        });
      } else {
        res.render('index', {
          title: 'Server Stats',
          hitsPerMinute
        });
      }
    });
  };
});

// Client closed
client.on('close', (error) => {
  if (persistInterval) {
    clearInterval(persistInterval);
  }
});

// Non-fatal error response when callback omitted
//client.on('call-error', (error) => { ... });

// Fatal client error
//client.on('error', (error) => { ... });

module.exports = app;
