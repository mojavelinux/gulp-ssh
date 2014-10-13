'use strict';
/*
 * gulp-ssh
 * https://github.com/teambition/gulp-ssh
 *
 * Copyright (c) 2014 Yan Qing
 * Licensed under the MIT license.
 */

var path = require('path');
var gulp = require('gulp');
var gutil = require('gulp-util');
var ssh2 = require('ssh2');
var through = require('through2');
var packageName = require('./package.json').name;

module.exports = GulpSSH;

function GulpSSH(options) {
  if (!(this instanceof GulpSSH)) return new GulpSSH(options);
  var ctx = this;

  this.options = options || {};
  this._connect = false;
  this._connected = false;
  this._readyEvents = [];

  this.ssh2 = new ssh2();
  this.ssh2
    .on('connect', function () {
      gutil.log(packageName + ' :: Connect...');
    })
    .on('ready', function () {
      gutil.log(packageName + ' :: Ready');
      ctx._connect = false;
      ctx._connected = true;
      flushReady(ctx);
    })
    .on('error', function (err) {
      gutil.colors.red(new gutil.PluginError(packageName, err));
    })
    .on('end', function () {
      gutil.log(packageName + ' :: End');
    })
    .on('close', function () {
      gutil.log(packageName + ' :: Close');
      ctx._connect = false;
      ctx._connected = false;
    });

  gulp.on('stop', function () {
    ctx.ssh2.end();
  });
}

function flushReady(ctx) {
  if (!ctx._connected) return;
  var listener = ctx._readyEvents.shift();
  while (listener) {
    listener.call(ctx);
    listener = ctx._readyEvents.shift();
  }
}

GulpSSH.prototype.connect = function (options) {
  var ctx = this;
  if (options) this.options.sshConfig = options;
  if (!this._connect && !ctx._connected) {
    this._connect = true;
    this.ssh2.connect(this.options.sshConfig);
  }
  return this;
};

GulpSSH.prototype.ready = function (fn) {
  this._readyEvents.push(fn);
  flushReady(this);
};

GulpSSH.prototype.exec = function (commands, options) {
  var ctx = this, outStream = through.obj(), ssh = this.ssh2, finish = false;

  if (!commands) throw new gutil.PluginError(packageName, '`commands` required.');

  commands = Array.isArray(commands) ? commands : [commands];

  var file = new gutil.File({
    cwd: __dirname,
    base: __dirname,
    path: path.join(__dirname, options.filePath || 'commands.log'),
    contents: through.obj()
  });

  outStream.write(file);
  this.connect().ready(execCommand);

  function endStream() {
    if (finish) return;
    finish = true;
    outStream.end();
  }

  function execCommand() {
    if (commands.length === 0) return endStream();
    var command = commands.shift();
    if (typeof command !== 'string') return execCommand();

    gutil.log(packageName + ' :: Executing :: ' + command);

    ssh.exec(command, options, function (err, stream) {
      if (err) return outStream.emit('error', new gutil.PluginError(packageName, err));

      stream
        .on('exit', function (code, signalName, didCoreDump, description) {
          if (ctx.ignoreErrors === false && code == null) {
            var message = signalName + ', ' + didCoreDump + ', ' + description;
            outStream.emit('error', new gutil.PluginError(packageName, message));
          }
        })
        .on('end', execCommand)
        .stderr.on('data', function (data) {
          outStream.emit('error', new gutil.PluginError(packageName, data + ''));
        });

      stream.pipe(file.contents, {end: false});
    });
  }

  return outStream;

};

GulpSSH.prototype.sftp = function (command, filePath, options) {
  var ctx = this, ssh = this.ssh2, finish = false, outStream;

  if (!command) throw new gutil.PluginError(packageName, '`command` required.');
  if (!filePath) throw new gutil.PluginError(packageName, '`filePath` required.');

  this.connect();

  function endStream() {
    if (finish) return;
    finish = true;
    outStream.end();
  }

  if (command === 'write') {
    outStream = through.obj(function (file, encoding, callback) {
      ctx.ready(function () {
        ssh.sftp(function(err, sftp) {
          if (err) return outStream.emit('error', new gutil.PluginError(packageName, err));
          var write = sftp.createWriteStream(filePath, options);

          write.on('finish', endStream);
          file.pipe(write);
          callback(null, file);
        });
      });
    });
  } else if (command === 'read') {
    var file = new gutil.File({
      cwd: __dirname,
      base: __dirname,
      path: path.join(__dirname, filePath)
    });
    outStream = through.obj();
    ctx.ready(function () {
      ssh.sftp(function(err, sftp) {
        if (err) return outStream.emit('error', new gutil.PluginError(packageName, err));
        file.contents = sftp.createReadStream(filePath, options);
        file.contents.on('close', endStream);
        outStream.write(file);
      });
    });
  }

  return outStream;

};

// 兼容 老版本
GulpSSH.exec = function (options) {
  if (typeof options.sshConfig !== 'object') {
    throw new gutil.PluginError(packageName, '`sshConfig` required.');
  }
  if (!options.command) {
    throw new gutil.PluginError(packageName, '`command` required.');
  }

  gutil.log('This method will be deprecated!');

  var execOptions = options.execOptions || {};
  var callback = options.onEnd || function () {};
  var gulpSSH = new GulpSSH({sshConfig: options.sshConfig});

  gulpSSH.exec(options.command, execOptions).on('end', callback);
};
