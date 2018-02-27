const gulp = require('gulp');

const clean = require('gulp-clean');
const sourcemaps = require('gulp-sourcemaps');

const rollup = require('gulp-better-rollup');
const rollupRoot = require('rollup-plugin-root-import');
// const babel = require('gulp-babel');

const cssImport = require('gulp-cssimport');
const cleanCss = require('gulp-clean-css');

const replace = require('gulp-replace');
const htmlReplace = require('gulp-html-replace');
const rename = require('gulp-rename');
const clone = require('gulp-clone');
const merge = require('merge2');

const staticAssets = require('./nimiq-static-assets');

class NimiqBuild {
    /**
     * Bundle js imports.
     * @param {string} jsEntry - entry point for the js from where other js files can be imported
     * @param {string} rootPath - The root path of the nimiq project structure. Must be an absolute path! (e.g. based on __dirname)
     * @param {string|null} [distPath] - Optional. Write the bundled file to this path.
     * @returns {Stream}
     */
    static bundleJs(jsEntry, rootPath, distPath = null) {
        let stream = gulp.src(jsEntry)
            .pipe(sourcemaps.init())
            .pipe(rollup({
                plugins: [
                    rollupRoot({
                        // specify absolute paths in order for rollup plugins to match module IDs
                        root: rootPath,
                        extensions: '.js'
                    })
                ]
            }, {
                format: 'iife'
            }));
        if (distPath) {
            stream = NimiqBuild._writeStream(stream, distPath);
        }
        return stream;
    }

    /**
     * Bundle css imports.
     * @param {string} cssEntry - entry point for the css from where other css files can be imported
     * @param {string} rootPath - The root path of the nimiq project structure. Must be an absolute path! (e.g. based on __dirname)
     * @param {string|null} [distPath] - Optional. Write the bundled file to this path.
     * @returns {Stream}
     */
    static bundleCss(cssEntry, rootPath, distPath = null) {
        let stream = gulp.src(cssEntry)
            .pipe(sourcemaps.init())
            .pipe(cssImport({
                includePaths: [rootPath],
                // transform absolute paths relative to root path
                transform: path => path.startsWith('/')? rootPath + path : path
            }))
            // the css import will inline the same css multiple times if imported multiple times thus we'll clean it up.
            .pipe(cleanCss({
                level: 2
            }));
        if (distPath) {
            stream = NimiqBuild._writeStream(stream, distPath);
        }
        return stream;
    }

    /**
     * Bundle js and css builds and browser-warning into the html.
     * @param {string} htmlEntry - The original html file.
     * @param {string} jsBundle - Path to the bundled js file, relative to the output html file.
     * @param {string} cssBundle - Path to the bundled css file, relative to the output html file.
     * @param {string} rootPath - The root path of the nimiq project structure. Must be an absolute path! (e.g. based on __dirname)
     * @param {string|null} [distPath] - Optional. Write the bundled file to this path.
     * @returns {Stream}
     */
    static bundleHtml(htmlEntry, jsBundle, cssBundle, rootPath, distPath = null) {
        let stream = gulp.src(htmlEntry)
            .pipe(htmlReplace({
                'js': jsBundle,
                'css': cssBundle,
                'browser-warning': gulp.src(rootPath + '/elements/browser-warning/browser-warning.html.template')
            }));
        if (distPath) {
            stream = NimiqBuild._writeStream(stream, distPath);
        }
        return stream;
    }

    /**
     * Copy assets and change paths in html, js and css to relative paths to the copied files.
     * @param {Array<String>} assetPaths - a list of assets that should be copied over to the dist folder
     * @param {Stream} htmlStream - A gulp stream for the HTML to process
     * @param {Stream} jsStream - A gulp stream for the JavaScript to process
     * @param {Stream} cssStream - A gulp stream for the CSS to process
     * @param {string} rootPath - The root path of the nimiq project structure. Must be an absolute path! (e.g. based on __dirname)
     * @param {string|null} [distPath] - Optional. Write the bundled file to this path.
     * @returns {[Stream,Stream,Stream,Stream]}
     */
    static moveAssets(assetPaths, htmlStream, jsStream, cssStream, rootPath, distPath = null) {
        const assetFileNames = assetPaths.map(path => NimiqBuild.getFileName(path));
        const resolvedAssetPaths = assetPaths.map(path => path.startsWith('/')? rootPath+path : path);
        const assetsStream = gulp.src(resolvedAssetPaths); // copy assets unchanged
        // replace the asset path in sources
        for (let i=0; i<assetPaths.length; ++i) {
            const regex = new RegExp(assetPaths[i], 'g');
            jsStream = jsStream.pipe(replace(regex, assetFileNames[i]));
            cssStream = cssStream.pipe(replace(regex, assetFileNames[i]));
            htmlStream = htmlStream.pipe(replace(regex, assetFileNames[i]));
        }
        if (distPath) {
            jsStream = NimiqBuild._writeStream(jsStream, distPath);
            cssStream = NimiqBuild._writeStream(cssStream, distPath);
            htmlStream = NimiqBuild._writeStream(htmlStream, distPath);
        }
        return [assetsStream, htmlStream, jsStream, cssStream];
    }

    /**
     * Create a new nimiq app build
     * @param {string} jsEntry - entry point for the js from where other js files can be imported
     * @param {string} cssEntry - entry point for the css from where other css files can be imported
     * @param {string} htmlEntry - entry point for the html which should include <!-- build:css -->, <!-- build:js --> and <!-- build:browser-warning -->
     * @param {Array.<String>} assetPaths - a list of assets that should be copied over to the dist folder
     * @param {string} rootPath - The root path of the nimiq project structure. Must be an absolute path! (e.g. based on __dirname)
     * @param {string} distPath - Where the output should be written to
     * @returns {Stream}
     */
    static build(jsEntry, cssEntry, htmlEntry, assetPaths, rootPath, distPath) {
        let jsStream = NimiqBuild.bundleJs(jsEntry, rootPath);
        let cssStream = NimiqBuild.bundleCss(cssEntry, rootPath);
        let htmlStream = NimiqBuild.bundleHtml(htmlEntry, NimiqBuild.getFileName(jsEntry),
            NimiqBuild.getFileName(cssEntry), rootPath);
        let assetsStream;
        [assetsStream, htmlStream, jsStream, cssStream] =
            NimiqBuild.moveAssets(assetPaths, htmlStream, jsStream, cssStream, rootPath);

        jsStream = jsStream.pipe(staticAssets({rootPath: rootPath}));
        cssStream = cssStream.pipe(staticAssets({rootPath: rootPath}));
        htmlStream = htmlStream.pipe(staticAssets({rootPath: rootPath}));

        /*
        // don't minify for now to not involve too many plugins into the build process
        const minJsStream = jsStream
            .pipe(clone())
            .pipe(rename('app.min.js'))
            .pipe(babel({
                presets: ['minify']
            })); */
        return NimiqBuild._writeStream(merge([jsStream, /*minJsStream,*/ cssStream, htmlStream, assetsStream]),
            distPath);
    }

    /**
     * Clean a build
     * @param {String} distFolder - where the app was built.
     * @returns {Stream}
     */
    static cleanBuild(distFolder) {
        return gulp.src(distFolder, {read: false})
            .pipe(clean());
    }

    static getFileName(path) {
        return path.substr(path.lastIndexOf('/') + 1);
    }

    static _writeStream(stream, distPath) {
        return stream.pipe(sourcemaps.write('.'))
            .pipe(gulp.dest(distPath));
    }
}

module.exports = NimiqBuild;