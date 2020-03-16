"use strict";

var _react = _interopRequireDefault(require("react"));

var _uuid = require("uuid");

var _server = require("react-dom/server");

var _reactRouterDom = require("react-router-dom");

var _fsExtra = require("fs-extra");

var _archiver = _interopRequireDefault(require("archiver"));

var _peritextUtils = require("peritext-utils");

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _objectSpread(target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i] != null ? arguments[i] : {}; var ownKeys = Object.keys(source); if (typeof Object.getOwnPropertySymbols === 'function') { ownKeys = ownKeys.concat(Object.getOwnPropertySymbols(source).filter(function (sym) { return Object.getOwnPropertyDescriptor(source, sym).enumerable; })); } ownKeys.forEach(function (key) { _defineProperty(target, key, source[key]); }); } return target; }

function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }

/**
 * =====================
 * PRIVATE UTILS
 * =====================
 */
const loaderCss = `#static-loader-container{
  position: fixed;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0,0,0,0.1);
  opacity: 0;
  transition: .5s ease;
}
.lds-ellipsis {
  display: inline-block;
  position: relative;
  width: 80px;
  height: 80px;
}
.lds-ellipsis div {
  position: absolute;
  top: 33px;
  width: 13px;
  height: 13px;
  border-radius: 50%;
  background: black;
  animation-timing-function: cubic-bezier(0, 1, 1, 0);
}
.lds-ellipsis div:nth-child(1) {
  left: 8px;
  animation: lds-ellipsis1 0.6s infinite;
}
.lds-ellipsis div:nth-child(2) {
  left: 8px;
  animation: lds-ellipsis2 0.6s infinite;
}
.lds-ellipsis div:nth-child(3) {
  left: 32px;
  animation: lds-ellipsis2 0.6s infinite;
}
.lds-ellipsis div:nth-child(4) {
  left: 56px;
  animation: lds-ellipsis3 0.6s infinite;
}
@keyframes lds-ellipsis1 {
  0% {
    transform: scale(0);
  }
  100% {
    transform: scale(1);
  }
}
@keyframes lds-ellipsis3 {
  0% {
    transform: scale(1);
  }
  100% {
    transform: scale(0);
  }
}
@keyframes lds-ellipsis2 {
  0% {
    transform: translate(0, 0);
  }
  100% {
    transform: translate(24px, 0);
  }
}`;

const renderHTML = ({
  singlePage,
  head,
  htmlContent,
  allowAnnotation,
  editionId,
  urlPrefix
}) => {
  const additionalMeta = `
      <script src="https://cdn.jsdelivr.net/npm/css-vars-ponyfill@1"></script>
      <link rel="stylesheet" href="${urlPrefix}/styles.css"></link>
      ${allowAnnotation ? '<script src="https://hypothes.is/embed.js" async></script>' : ''}
  `;
  const finalHead = head.replace(/<\/head>$/, `${additionalMeta.trim()}</head>`);
  let baseName = '';

  if (urlPrefix && urlPrefix.length) {
    const withoutProtocol = urlPrefix.replace(/^https?:\/\//, '');
    const parts = withoutProtocol.split('/');
    const withoutDomain = parts.length > 1 ? parts.slice(1).join('/') : parts[0];
    baseName = `/${withoutDomain}${withoutDomain.charAt(withoutDomain.length - 1) === '/' ? '' : '/'}`;
  }

  return `<!DOCTYPE html>
<html>
  <head>
    ${finalHead}
  </head>
  <body>
    
    <div id="mount"></div>
    <div id="static">
      ${htmlContent}
    </div>

    <script src="${urlPrefix}/bundle.js" type="text/javascript"></script>
    <style>
${loaderCss}
    </style>
    <script>
          var __useBrowserRouter = ${singlePage ? 'false' : 'true'};
          var __editionId = "${editionId}";
          window.__urlBaseName = "${baseName}";
          /**
           * LIB
           */

          function loadJSON(URL, callback) {   
            var xobj = new XMLHttpRequest();
                xobj.overrideMimeType("application/json");
            xobj.open('GET', URL, true); // Replace 'my_data' with the path to your file
            xobj.onreadystatechange = function () {
                  if (xobj.readyState == 4 && xobj.status == "200") {
                    // Required use of an anonymous callback as .open will NOT return a value but simply returns undefined in asynchronous mode
                    var json = xobj.responseText;
                    if (typeof json === 'string') {
                      json = JSON.parse(json)
                    }
                    callback(json);
                  }
            };
            xobj.send(null);  
        }
        function addLoader() {
          var loader = document.createElement('div')
          loader.id = 'static-loader-container';
          loader.innerHTML = '<div class="lds-ellipsis"><div></div><div></div><div></div><div></div></div>';
          document.body.appendChild(loader);
          loader.style.opacity = 1;
        }
        function hideLoader() {
          var loader = document.getElementById('static-loader-container')
          loader.style.opacity = 0;
          loader.style.pointerEvents = 'none';
        }
        /**
         * EXECUTION
         */
        addLoader();
        loadJSON('${urlPrefix}/locale.json', locale => {
          loadJSON('${urlPrefix}/preprocessedData.json', preprocessedData => {
              loadJSON('${urlPrefix}/production.json', production => {
                renderEdition(production, __editionId, preprocessedData, locale, __useBrowserRouter, true);
                hideLoader();
              }) 
          })
        })
    </script>
  </body>
</html>
    `.trim();
};
/**
 * Generates an archive from parameters
 * @return Promise - promise of the process
 */


function generateOutput({
  production: initialProduction = {},
  edition = {},
  peritextConfig = {},
  locale = {},
  urlPrefix = '',
  outputPath,
  preprocessedData,
  tempDirPath = './temp',
  requestAssetData,
  onFeedback,
  templatesBundlesPath // config = {},

}) {
  const jobId = (0, _uuid.v4)();
  const jobTempFolderPath = `${tempDirPath}/${jobId}`;
  const outputAssetsPath = `${jobTempFolderPath}`;
  const {
    templates
  } = peritextConfig;
  const template = templates.find(thatT => thatT.meta.id === edition.metadata.templateId);
  const templateStyle = template.css;
  const utils = template.utils;
  const {
    routeItemToUrl
  } = utils;
  let loadedProduction;
  let editionAssets;

  if (typeof onFeedback === 'function') {
    onFeedback({
      type: 'info',
      message: 'starting generation'
    });
  }

  return new Promise((resolve, reject) => {
    Promise.resolve().then(() => (0, _fsExtra.ensureDir)(outputAssetsPath)).then(() => {
      if (typeof onFeedback === 'function') {
        onFeedback({
          type: 'info',
          message: 'loading assets'
        });
      }

      return (0, _peritextUtils.loadAssetsForEdition)({
        production: initialProduction,
        edition,
        requestAssetData
      });
    }).then(loadedAssets => {
      if (typeof onFeedback === 'function') {
        onFeedback({
          type: 'info',
          message: 'loading template'
        });
      }

      editionAssets = loadedAssets;
      loadedProduction = _objectSpread({}, initialProduction, {
        assets: loadedAssets
      });
      const templatePath = `${templatesBundlesPath}/${edition.metadata.templateId}/bundle.js`;
      return (0, _fsExtra.readFile)(templatePath, 'utf8');
    }).then(jsBundle => {
      return (0, _fsExtra.writeFile)(`${jobTempFolderPath}/bundle.js`, jsBundle, 'utf8');
    }).then(() => {
      if (typeof onFeedback === 'function') {
        onFeedback({
          type: 'info',
          message: 'packing assets'
        });
      }

      return Object.keys(editionAssets).reduce((cur, assetId, assetIndex) => {
        return cur.then(() => new Promise((res1, rej1) => {
          const asset = editionAssets[assetId];
          const mimetype = asset.mimetype;
          const assetDirPath = `${outputAssetsPath}/assets/${asset.id}`;
          const assetFilePath = `${assetDirPath}/${asset.filename}`;
          const url = `${urlPrefix}/assets/${asset.id}/${asset.filename}`;

          if (typeof onFeedback === 'function') {
            onFeedback({
              type: 'info',
              message: 'packing asset',
              payload: {
                currentIndex: assetIndex,
                totalIndex: Object.keys(editionAssets).length
              }
            });
          }

          switch (mimetype) {
            case 'image/png':
            case 'image/jpeg':
            case 'image/jpg':
            case 'image/gif':
            case 'image/tiff':
              const ext = asset.mimetype.split('/').pop();
              const regex = new RegExp(`^data:image\/${ext};base64,`);
              const data = asset.data.replace(regex, '');
              (0, _fsExtra.ensureDir)(assetDirPath).then(() => {
                return (0, _fsExtra.writeFile)(assetFilePath, data, 'base64');
              }).then(() => {
                editionAssets[assetId].data = url;
              }).then(res1).catch(rej1);
              break;

            /**
             * @todo externalize table files as well
             */
            // case 'text/csv':/* eslint no-fallthrough : 0 */
            // case 'text/tsv':
            // case 'text/comma-separated-values':
            // case 'text/tab-separated-values':
            //   return writeFile( address, JSON.stringify( asset.data ), 'utf8' );

            default:
              res1();
              break;
          }
        }));
      }, Promise.resolve());
    }).then(() => {
      const finalAssets = _objectSpread({}, initialProduction, {
        assets: editionAssets
      });

      return (0, _fsExtra.writeFile)(`${jobTempFolderPath}/production.json`, JSON.stringify(finalAssets), 'utf8');
    }).then(() => {
      if (preprocessedData) {
        return (0, _fsExtra.writeFile)(`${jobTempFolderPath}/preprocessedData.json`, JSON.stringify(preprocessedData), 'utf8');
      } else return Promise.resolve();
    }).then(() => {
      return (0, _fsExtra.writeFile)(`${jobTempFolderPath}/locale.json`, JSON.stringify(locale, null, 2), 'utf8');
    }).then(() => {
      const styles = (0, _peritextUtils.resolveEditionCss)({
        edition,
        contextualizerModules: peritextConfig.contextualizers,
        templateStyle
      });
      return (0, _fsExtra.writeFile)(`${jobTempFolderPath}/styles.css`, styles, 'utf8');
    }).then(() => {
      const production = loadedProduction;

      if (typeof onFeedback === 'function') {
        onFeedback({
          type: 'info',
          message: 'building website'
        });
      }

      const nav = utils.buildNav({
        production: initialProduction,
        edition,
        locale
      }).concat(utils.getAdditionalRoutes()).map((navItem, navItemIndex) => {
        return _objectSpread({}, navItem, {
          route: routeItemToUrl(navItem, navItemIndex)
        });
      });
      return nav.reduce((cur, navItem) => cur.then(() => new Promise((res1, rej1) => {
        const {
          route,
          viewId,
          routeClass,
          routeParams
        } = navItem;
        const routeFolder = `${jobTempFolderPath}${route.split('?')[0]}`;
        const Comp = template.components.Edition;
        let htmlContent = '';

        try {
          htmlContent = (0, _server.renderToString)(_react.default.createElement(_reactRouterDom.StaticRouter, {
            context: {},
            location: navItem.route
          }, _react.default.createElement(Comp, {
            viewId: viewId,
            viewClass: routeClass,
            viewParams: routeParams,
            production: production,
            edition: edition,
            locale: locale,
            contextualizers: peritextConfig.contextualizers,
            excludeCss: true,
            preprocessedData: preprocessedData,
            previewMode: true,
            staticRender: true
          })));
        } catch (e) {
          console.error('e', e);
          /* eslint no-console : 0 */
        }

        const head = (0, _server.renderToStaticMarkup)(utils.renderHeadFromRouteItem({
          production: loadedProduction,
          edition,
          item: navItem
        }));
        const {
          data = {}
        } = edition;
        const {
          allowAnnotation = false
        } = data;
        const html = renderHTML({
          singlePage: false,
          head,
          htmlContent,
          allowAnnotation,
          editionId: edition.id,
          urlPrefix
        });
        (0, _fsExtra.ensureDir)(routeFolder).then(() => (0, _fsExtra.writeFile)(`${routeFolder}/index.html`, html, 'utf8')).then(res1).catch(rej1);
      })), Promise.resolve());
    })
    /**
     * Creating and filling the archive
     */
    .then(() => {
      if (typeof onFeedback === 'function') {
        onFeedback({
          type: 'info',
          message: 'creating archive'
        });
      }

      return new Promise((res1, rej1) => {
        const output = (0, _fsExtra.createWriteStream)(outputPath);
        const archive = (0, _archiver.default)('zip', {
          zlib: {
            level: 9
          } // Sets the compression level.

        });
        archive.directory(jobTempFolderPath, false);
        /*
         * listen for all archive data to be written
         * 'close' event is fired only when a file descriptor is involved
         */

        output.on('close', function () {
          if (typeof onFeedback === 'function') {
            onFeedback({
              type: 'success',
              message: 'archive created'
            });
          }

          res1();
        });
        /*
         * This event is fired when the data source is drained no matter what was the data source.
         * It is not part of this library but rather from the NodeJS Stream API.
         * @see: https://nodejs.org/api/stream.html#stream_event_end
         */

        output.on('end', function () {
          if (typeof onFeedback === 'function') {
            onFeedback({
              type: 'success',
              message: 'archive created'
            });
          }

          res1();
        }); // good practice to catch warnings (ie stat failures and other non-blocking errors)

        archive.on('warning', function (err) {
          if (err.code === 'ENOENT') {// log warning
          } else {
            if (typeof onFeedback === 'function') {
              onFeedback({
                type: 'error',
                message: 'archive error',
                payload: {
                  error: err
                }
              });
            } // throw error


            rej1(err);
          }
        }); // good practice to catch this error explicitly

        archive.on('error', function (err) {
          if (typeof onFeedback === 'function') {
            onFeedback({
              type: 'error',
              message: 'archive error',
              payload: {
                error: err
              }
            });
          }

          rej1(err); // throw err;
        }); // pipe archive data to the file

        archive.pipe(output);
        archive.finalize();
      });
    }).then(() => {
      if (typeof onFeedback === 'function') {
        onFeedback({
          type: 'info',
          message: 'cleaning temporary files'
        });
      }

      (0, _fsExtra.remove)(jobTempFolderPath);
    }).then(resolve).catch(reject);
  });
}

module.exports = {
  meta: {
    id: 'single-page-html',
    type: 'peritext-generator',
    name: 'Single HTML page generator',
    generatorType: 'single-page-html',
    outputFormat: 'html',
    interfaceCoverage: ['desktop']
  },
  generateOutput
};