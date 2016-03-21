module.exports = function (shipit) {
  require('shipit-deploy')(shipit);

  /**
   * Initialize config.
   */

  shipit.initConfig({
    default: {
      // Project will be build in this directory.
      workspace: '/tmp/spotiplay-node-workspace',

      // Project will be deployed in this directory.
      deployTo: '~/spotiplay-node',

      // Repository url.
      repositoryUrl: "ssh://git@github.com/dennislysenko/spotiplay-node.git",

      // This files will not be transfered.
      ignores: ['.git', 'node_modules'],

      // Number of release to keep (for rollback).
      keepReleases: 3
    },

    production: {
      servers: 'deploy@dennis'
    }
  });

  shipit.on('published', function() {
    shipit.remote('cp ~/spotiplay-node/shared/.env ~/spotiplay-node/current', function(err, res) {
      if (err) {
        console.log(err);
      } else {
        shipit.emit('env-copied');
      }
    })
  });

  shipit.on('env-copied', function() {
    shipit.remote('cd ~/spotiplay-node/current && npm install > /dev/null', function(err, res) {
      if (err) {
        console.log(err);
      } else {
        shipit.emit('packages-installed');
      }
    });
  });

  shipit.on('packages-installed', function () {
    shipit.remote('forever stopall > /dev/null', function(err, res) {
      if (err) {
        console.log(err);
      } else {
        shipit.remote('forever start ~/spotiplay-node/current/app.js', function(err, res) {
          if (!err) {
            shipit.remote('forever list');
          }
        });
      }
    });
  });
};
