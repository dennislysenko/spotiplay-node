/**
 * Created by dennis on 3/13/16.
 */

var express = require('express'); // Express web server framework
var request = require('request'); // "Request" library
var querystring = require('querystring');
var playmusic = require('playmusic');
var crypto = require('crypto');

//if (!process.env.PORT) {
// Load environment variables on local setup
var env = require('node-env-file');
env(__dirname + '/.env');
//}

var app = express();

//function encrypt(password) {
//  var key = new Buffer(process.env.ENCRYPTION_KEY, 'base64').toString('binary');
//  var cipher = crypto.createCipheriv('aes-256-ctr', key);
//  return Buffer.concat([cipher.update(password), cipher.final()]).toString("base64");
//}

function decrypt(password, iv64) {
  var encryptdata = new Buffer(password, 'base64').toString('binary');
  var key = new Buffer(process.env.ENCRYPTION_KEY, 'base64').toString('binary');
  var iv = new Buffer(iv64, 'base64').toString('binary');
  var decipher = crypto.createDecipheriv('aes-256-ctr', key, iv);
  return Buffer.concat([decipher.update(encryptdata), decipher.final()]).toString("utf-8");
}

function pmroute(path, callback) {
  app.get(path, function(req, res) {
    if (!req.query.email || !req.query.password) {
      res.send({ success: false, error: 'Please include an email and a password' });
    } else {
      var password = decrypt(req.query.password, req.query.iv);
      var pm = new playmusic();
      pm.init({ email: req.query.email, password: password }, function(err) {
        if (err) {
          res.send({ success: false, error: 'Error initing play music wrapper: ' + err, error_obj: err, password: password, pass: req.query.password})
        } else {
          callback(req, res, pm);
        }
      })
    }
  });
}

app.get('/encrypt', function(req, res) {
  res.send({ crypted: encrypt(req.query.text) });
});

app.get('/decrypt', function(req, res) {
  res.send({ decrypted: decrypt(req.query.text) });
});

pmroute('/playlists', function(req, res, pm) {
  pm.getPlayLists(function(err, data) {
    var playlists = data.data.items;
    res.send({ playlists: playlists });
  })
});

pmroute('/playlist_entries', function(req, res, pm) {
  function request(callback, pageToken) {
    pm.request({
      method: "POST",
      url: pm._baseURL + 'plentryfeed',
      contentType: 'application/json',
      data: JSON.stringify({'start-token': pageToken})
    }, function(err, body) {
      if (err != null) {
        callback(err, null);
      } else {
        var entries = body.data.items;

        if (typeof body.nextPageToken == "string") {
          // recursive case, more pages
          request(function(err, newEntries) {
            if (err != null) {
              callback(err, null);
            } else {
              // add new entries to entries we've already loaded and send those up to the parent frame
              callback(null, entries.concat(newEntries));
            }
          }, body.nextPageToken);
        } else {
          // base case, no more pages, just send up what we have. whew
          callback(null, entries);
        }
      }
    });
  }

  // jesus this is going to run for a LONG time
  request(function(err, allEntries) {
    if (err != null) {
      res.send({error: err});
    } else {
      res.send({count: allEntries.length, entries: allEntries});
    }
  });

  //pm.getPlayListEntries(function(err, data) {
  //  var entries = data.data.items;
  //  // res.send({ entries: entries });
  //  res.send(data);
  //})
});

pmroute('/all_tracks', function(req, res, pm) {
  pm.getAllTracks(function(err, data) {
    var entries = data.data.items;
    res.send({ entries: entries });
  })
});

app.get('/key', function(req, res) {
  res.send({ key: new Buffer(process.env.ENCRYPTION_KEY, 'base64').toString('binary') })
});

var port = process.env.PORT || 7045;
console.log('Listening on ' + port);
app.listen(port);
