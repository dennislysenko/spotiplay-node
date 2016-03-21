/**
 * Created by dennis on 3/13/16.
 */

var express = require('express'); // Express web server framework
var request = require('request'); // "Request" library
var querystring = require('querystring');
var playmusic = require('playmusic');
var crypto = require('crypto');
var uuid = require('node-uuid');

//if (!process.env.PORT) {
// Load environment variables on local setup
var env = require('node-env-file');
env(__dirname + '/.env');
//}

var app = express();

var bodyParser = require('body-parser');
app.use(bodyParser.json());       // to support JSON-encoded bodies
app.use(bodyParser.urlencoded({     // to support URL-encoded bodies
  extended: true
}));

//app.use(express.json());       // to support JSON-encoded bodies
//app.use(express.urlencoded()); // to support URL-encoded bodies

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

function pmroute(type, path, callback) {
  type.call(app, path, function(req, res) {
    var source;
    if (type == app.get) {
      source = req.query;
    } else {
      source = req.body;
    }
    if (!source.email || !source.password || !source.iv) {
      res.send({ success: false, error: 'Please include an email an encrypted password, and an iv' });
    } else {
      var password = decrypt(source.password, source.iv);
      var pm = new playmusic();
      pm.init({ email: source.email, password: password }, function(err) {
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

pmroute(app.get, '/playlists', function(req, res, pm) {
  pm.getPlayLists(function(err, data) {
    var playlists = data.data.items;
    res.send({ playlists: playlists });
  })
});

function pagedRequest(pm, path, callback) {
  function request(callback, pageToken) {
    pm.request({
      method: "POST",
      url: pm._baseURL + path,
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
  request(callback);
  //request();
}

pmroute(app.get, '/playlist_entries', function(req, res, pm) {
  pagedRequest(pm, 'plentryfeed', function(err, allEntries) {
    if (err != null) {
      res.send({error: err});
    } else {
      res.send({count: allEntries.length, entries: allEntries});
    }
  });
});

pmroute(app.get, '/all_tracks', function(req, res, pm) {
  pagedRequest(pm, 'trackfeed', function(err, allEntries) {
    if (err != null) {
      res.send({error: err});
    } else {
      res.send({count: allEntries.length, entries: allEntries});
    }
  });
});

pmroute(app.post, '/remove_entries', function(req, res, pm) {
  if (typeof req.body.entry_ids != "string") {
    res.send({success: false, error: "Bad request, need entry_ids in post"});
  } else {
    var entryIds = req.body.entry_ids.split(",");
    var mutations = entryIds.map(function (id) {
      return {"delete": id}
    });
    //res.send({mutations: mutations});
    pm.request({
      method: "POST",
      contentType: "application/json",
      url: pm._baseURL + 'plentriesbatch?' + querystring.stringify({alt: "json"}),
      data: JSON.stringify({"mutations": mutations})
    }, function (err, body) {
      if (err != null) {
        res.send({success: false, error: "Error removing playlist entries: " + err});
      } else {
        res.send({success: true, body: body});
      }
    });
  }
});

pmroute(app.post, '/remove_entry', function(req, res, pm) {
  pm.removePlayListEntry(req.body.entry_id, function(err, body) {
    if (err != null) {
      res.send({success: false, error: err});
    } else {
      res.send({success: true, body: body});
    }
  });
});

pmroute(app.post, '/search', function(req, res, pm) {
  pm.search(req.body.query, 5, function(err, data) {
    if (err != null) {
      res.send({success: false, error: err});
    } else {
      res.send({success: true, results: data.entries});
    }
  });
});

pmroute(app.post, '/add_entries', function(req, res, pm) {
  var mutations = req.body.track_ids.split(",").map(function(songId) {
    return {
      "create": {
        "clientId": uuid.v1(),
        "creationTimestamp": "-1",
        "deleted": "false",
        "lastModifiedTimestamp": "0",
        "playlistId": req.body.playlist_id,
        "source": (songId.indexOf("T") === 0 ? "2" : "1"),
        "trackId": songId
      }
    }
  });

  pm.request({
    method: "POST",
    contentType: "application/json",
    url: pm._baseURL + 'plentriesbatch?' + querystring.stringify({alt: "json"}),
    data: JSON.stringify({"mutations": mutations})
  }, function (err, body) {
    if (err != null) {
      res.send({success: false, error: "Error adding playlist entries: " + err});
    } else {
      res.send({success: true, body: body});
    }
  });
});

app.get('/key', function(req, res) {
  res.send({ key: new Buffer(process.env.ENCRYPTION_KEY, 'base64').toString('binary') })
});

var port = process.env.PORT || 7045;
console.log('Listening on ' + port);
app.listen(port);
