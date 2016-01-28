'use strict'
let Concat = require('concat-with-sourcemaps');
let Promise = require('bluebird');
let path = require('path');
let fs = require('fs-extra-promise');

module.exports = function (mikser, context) {

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
			sourceExt: '.js',
			destinationExt: path.extname(destination),
			generateSourceMap: sourcemap === true ? sourcemap : false,
		}
		concatInfo.destination = concatInfo.sourceExt === concatInfo.destinationExt ? path.join(mikser.config.outputFolder, destination) : path.join(mikser.config.outputFolder, destination, path.basename(context.layouts[0]._id, path.extname(context.layouts[0]._id)) + '.all' + concatInfo.sourceExt);
		concatInfo.outDir = path.dirname(concatInfo.destination);

		context.pending = context.pending.then(() => {
			if (mikser.manager.isNewer(sources, concatInfo.destination)) {
				let outFile = concatInfo.destination + '.map';
				let concatFile = new Concat(concatInfo.generateSourceMap, outFile, '\n');
				return Promise.map(sources, (script) => {
					return Promise.join(fs.readFileAsync(script), script, (scriptContent, scriptPath) => {
						return {
							file: scriptPath,
							content: scriptContent
						}
					});
				}).then((readFiles) => {
					readFiles.forEach((readFile) => {
						concatFile.add(path.join(path.relative(concatInfo.outDir, path.dirname(readFile.file)), path.basename(readFile.file)), readFile.content);
					});
					concatFile.add(null, '//# sourceMappingURL=' + path.basename(outFile));
					if (concatInfo.generateSourceMap) {
						return Promise.all([fs.outputFileAsync(concatInfo.destination, concatFile.content), fs.outputFileAsync(outFile, concatFile.sourceMap)]);
					} else {
						return fs.outputFileAsync(concatInfo.destination, concatFile.content);
					}
				});
			} else {
				return Promise.resolve();
			}
		});
		return mikser.manager.getUrl(concatInfo.destination);

	}
}