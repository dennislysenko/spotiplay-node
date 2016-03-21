/**
 * Created by dennis on 3/13/16.
 */

var express = require('express'); // Express web server framework
var request = require('request'); // "Request" library
var querystring = require('querystring');
var playmusic = require('playmusic');
var crypto = require('crypto');
var uuid = require('node-uuid');

var env = require('node-env-file');
env(__dirname + '/.env');

var app = express();

var bodyParser = require('body-parser');
app.use(bodyParser.json());       // to support JSON-encoded bodies
app.use(bodyParser.urlencoded({     // to support URL-encoded bodies
  extended: true
}));

function decrypt(password, iv64) {
  var encryptdata = new Buffer(password, 'base64').toString('binary');
  var key = new Buffer(process.env.ENCRYPTION_KEY, 'base64').toString('binary');
  var iv = new Buffer(iv64, 'base64').toString('binary');
  var decipher = crypto.createDecipheriv('aes-256-ctr', key, iv);
  return Buffer.concat([decipher.update(encryptdata), decipher.final()]).toString("utf-8");
}

/**
 * Helper to create an express route with a given HTTP/express verb, a route,
 * and a callback that takes a PlayMusic instance in addition to the standard request and response objects.
 */
function pmroute(verb, route, callback) {
  verb.call(app, route, function (req, res) {
    var source;
    if (verb == app.get) {
      source = req.query;
    } else {
      source = req.body;
    }
    if (!source.email || !source.password || !source.iv) {
      res.send({success: false, error: 'Please include an email an encrypted password, and an iv'});
    } else {
      var password = decrypt(source.password, source.iv);
      var pm = new playmusic();
      pm.init({email: source.email, password: password}, function (err) {
        if (err) {
          res.send({
            success: false,
            error: 'Error initing play music wrapper: ' + err,
            error_obj: err,
            password: password,
            pass: req.query.password
          })
        } else {
          callback(req, res, pm);
        }
      })
    }
  });
}

pmroute(app.get, '/playlists', function (req, res, pm) {
  pm.getPlayLists(function (err, data) {
    var playlists = data.data.items;
    res.send({playlists: playlists});
  })
});

/**
 * Helper method for paged requests that uses a hellish form of async combined with recursion to consolidate all the
 * pages together into one array before calling the callback.
 *
 * I really should have used promises for this since this code is going to be public.
 * No regrets though, it worked first try.
 */
function pagedRequest(pm, path, callback) {
  function request(callback, pageToken) {
    pm.request({
      method: "POST",
      url: pm._baseURL + path,
      contentType: 'application/json',
      data: JSON.stringify({'start-token': pageToken})
    }, function (err, body) {
      if (err != null) {
        callback(err, null);
      } else {
        var entries = body.data.items;

        if (typeof body.nextPageToken == "string") {
          // recursive case, more pages
          request(function (err, newEntries) {
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

  request(callback);
}

pmroute(app.get, '/playlist_entries', function (req, res, pm) {
  pagedRequest(pm, 'plentryfeed', function (err, allEntries) {
    if (err != null) {
      res.send({error: err});
    } else {
      res.send({count: allEntries.length, entries: allEntries});
    }
  });
});

pmroute(app.get, '/all_tracks', function (req, res, pm) {
  pagedRequest(pm, 'trackfeed', function (err, allEntries) {
    if (err != null) {
      res.send({error: err});
    } else {
      res.send({count: allEntries.length, entries: allEntries});
    }
  });
});

pmroute(app.post, '/remove_entries', function (req, res, pm) {
  if (typeof req.body.entry_ids != "string") {
    res.send({success: false, error: "Bad request, need entry_ids in post"});
  } else {
    var entryIds = req.body.entry_ids.split(",");
    var mutations = entryIds.map(function (id) {
      return {"delete": id}
    });

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

pmroute(app.post, '/remove_entry', function (req, res, pm) {
  pm.removePlayListEntry(req.body.entry_id, function (err, body) {
    if (err != null) {
      res.send({success: false, error: err});
    } else {
      res.send({success: true, body: body});
    }
  });
});

pmroute(app.post, '/search', function (req, res, pm) {
  pm.search(req.body.query, 5, function (err, data) {
    if (err != null) {
      res.send({success: false, error: err});
    } else {
      res.send({success: true, results: data.entries});
    }
  });
});

pmroute(app.post, '/add_entries', function (req, res, pm) {
  var mutations = req.body.track_ids.split(",").map(function (songId) {
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

var port = process.env.PORT || 7045;
console.log('Listening on ' + port);
app.listen(port);
