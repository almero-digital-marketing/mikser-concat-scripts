'use strict'
let Concat = require('concat-with-sourcemaps');
let Promise = require('bluebird');
let path = require('path');
let fs = require('fs-extra-promise');
let _ = require('lodash');
let touch = require('touch');
let cluster = require('cluster');

module.exports = function (mikser, context) {
	let debug = mikser.debug('concat-scripts');

	if(!context) {

		let map = {};
		let runtimeMap = path.join(mikser.config.runtimeFolder, 'concat-scripts.json');
		if (fs.existsSync(runtimeMap)) {
			map = JSON.parse(fs.readFileSync(runtimeMap, 'utf-8'));
		}

		mikser.on('mikser.watcher.outputAction', (event, file) => {
			file = path.join(mikser.config.outputFolder, file);
			let destinationsToRealod = _.keys(_.pickBy(map, (destination) => {
				return destination.sources.indexOf(file) !== -1;
			}));

			if (destinationsToRealod.length && (event == 'change' || event == 'unlink')) {
				debug('Concatenating:', file, '->' ,destinationsToRealod.join(','));
				return Promise.map(destinationsToRealod, (destination) => {
					if (event == 'unlink') Array.prototype.splice.call(map[destination].sources, map[destination].sources.indexOf(file), 1);
					return concat(map[destination]);
				});
			} else {
				return Promise.resolve();
			}
		});

		function concat(info) {
			map[info.destination] = {
				sources: info.sources,
				sourcemap: info.sourcemap === true ? info.sourcemap : false,
				destination: info.destination
			}
			info.outDir = path.dirname(info.destination);
			// update runtime json with new info
			fs.writeFileSync(runtimeMap, JSON.stringify(map, null, 2));

			if (mikser.manager.isNewer(info.sources, info.destination)) {
				// Lock inline file for further usage by creating it and updating its mtime;
				fs.ensureFileSync(info.destination);
				touch.sync(info.destination);
				let mapFile = info.destination + '.map';
				let concatFile = new Concat(info.sourcemap, mapFile, '\n');
				debug('Concat started: ', info.destination);
				return Promise.map(info.sources, (script) => {
					return Promise.join(fs.readFileAsync(script), script, (scriptContent, scriptPath) => {
						return {
							file: scriptPath,
							content: scriptContent
						}
					});
				}).then((readFiles) => {
					readFiles.forEach((readFile) => {
						concatFile.add(path.join(path.relative(info.outDir, path.dirname(readFile.file)), path.basename(readFile.file)), readFile.content);
					});
					concatFile.add(null, '//# sourceMappingURL=' + path.basename(mapFile));
					if (info.sourcemap) {
						return Promise.all([fs.outputFileAsync(info.destination, concatFile.content), fs.outputFileAsync(mapFile, concatFile.sourceMap)]).then(() => debug('Concat finished'));
					} else {
						return fs.outputFileAsync(info.destination, concatFile.content).then(() => debug('Concat finished'));
					}
				});
			} else {
				debug('Destination is up to date: ', info.destination);
				return Promise.resolve();
			}
		}

		return Promise.resolve({concat: concat});
	} else {
		context.concatScripts = function (sources, destination, sourcemap) {
			if (!sources) {
				let err = new Error('Undefined source list');
				err.origin = 'concat';
				throw err;
			}

			if (!Array.isArray(sources)) sources = [sources];
			let share = mikser.manager.getShare(context.document.destination);
			sources.forEach((source, index, arr) => {
				if (share){
					arr[index] = path.join(mikser.config.outputFolder, share, source);
				}
				else {
					arr[index] = path.join(mikser.config.outputFolder, source);
				}
			});

			if (!destination) {
				let err = new Error('Undefined destination');
				err.origin = 'concat';
				throw err;
			}

			let concatInfo = {
				sources: sources,
				sourceExt: '.js',
				destinationExt: path.extname(destination),
				sourcemap: sourcemap === true ? sourcemap : false,
			}
			concatInfo.destination = concatInfo.sourceExt === concatInfo.destinationExt ? path.join(mikser.config.outputFolder, destination) : path.join(mikser.config.outputFolder, destination, path.basename(context.layouts[0]._id, path.extname(context.layouts[0]._id)) + '.all' + concatInfo.sourceExt);

			context.process(() => {
				let concat;
				if (cluster.isMaster) {
					concat = mikser.plugins.concatScripts.concat(concatInfo);
				} else {
					concat = mikser.broker.call('mikser.plugins.concatScripts.concat', concatInfo);
				}
				return concat.catch((err) => {
					mikser.diagnostics.log(context, 'error', 'Error concatenating:', concatInfo.destination, err);
				});
			});
			return mikser.manager.getUrl(concatInfo.destination);
		}

	}
}