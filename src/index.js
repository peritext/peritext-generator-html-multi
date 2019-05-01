import React from 'react';
import { v4 as genId } from 'uuid';
import { renderToString, renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom';
import {
  writeFile,
  ensureDir,
  remove,
  readFile,
  createWriteStream,
} from 'fs-extra';
import archiver from 'archiver';

import {
  loadAssetsForEdition,
} from 'peritext-utils';

/**
 * Generates an archive from parameters
 * @return Promise - promise of the process
 */
function generateOutput ( {
  production: initialProduction = {},
  edition = {},
  peritextConfig = {},
  locale = {},
  outputPath,
  tempDirPath = './temp',
  requestAssetData,
  onFeedback,
  basePath,
  config = {},
} ) {
  const jobId = genId();

  const jobTempFolderPath = `${tempDirPath}/${jobId}`;
  const outputAssetsPath = `${jobTempFolderPath}`;

  const { templates } = peritextConfig;
  const template = templates.find( ( thatT ) => thatT.meta.id === edition.metadata.templateId );
  const utils = template.utils;
  const { routeItemToUrl } = utils;
  let loadedProduction;
  let editionAssets;
  if ( typeof onFeedback === 'function' ) {
    onFeedback( {
      type: 'info',
      message: 'starting generation'
    } );
  }
  return new Promise( ( resolve, reject ) => {
    Promise.resolve()
    .then( () =>
      ensureDir( outputAssetsPath )
    )
    .then( () => {
      if ( typeof onFeedback === 'function' ) {
        onFeedback( {
          type: 'info',
          message: 'starting generation'
        } );
      }
      return loadAssetsForEdition( {
        production: initialProduction,
        edition,
        requestAssetData
      } );
    } )
    .then( ( loadedAssets ) => {
      if ( typeof onFeedback === 'function' ) {
        onFeedback( {
          type: 'info',
          message: 'loading template'
        } );
      }
      editionAssets = loadedAssets;
      loadedProduction = {
          ...initialProduction,
          assets: loadedAssets
        };
      const templatePath = `${basePath}/app/htmlBuilds/single-page-html/${edition.metadata.templateId}/bundle.js`;
      return readFile( templatePath, 'utf8' );
    } )
    .then( ( jsBundle ) => {
      return writeFile( `${jobTempFolderPath}/bundle.js`, jsBundle, 'utf8' );
    } )
    .then( () => {
      if ( typeof onFeedback === 'function' ) {
        onFeedback( {
          type: 'info',
          message: 'packing assets'
        } );
      }
      return Object.keys( editionAssets ).reduce( ( cur, assetId, assetIndex ) => {
        return cur
        .then( () => new Promise( ( res1, rej1 ) => {
          const asset = editionAssets[assetId];
          const mimetype = asset.mimetype;
          const assetDirPath = `${outputAssetsPath}/${asset.id}`;
          const assetFilePath = `${assetDirPath}/${asset.filename}`;
          const url = `/${asset.id}/${asset.filename}`;
          if ( typeof onFeedback === 'function' ) {
            onFeedback( {
              type: 'info',
              message: 'packing asset',
              payload: {
                currentIndex: assetIndex,
                totalIndex: Object.keys( editionAssets ).length
              }
            } );
          }
          switch ( mimetype ) {
            case 'image/png':
            case 'image/jpeg':
            case 'image/jpg':
            case 'image/gif':
            case 'image/tiff':

              const ext = asset.mimetype.split( '/' ).pop();
              const regex = new RegExp( `^data:image\/${ext};base64,` );
              const data = asset.data.replace( regex, '' );
              ensureDir( assetDirPath )
                .then( () => {
                  return writeFile( assetFilePath, data, 'base64' );
                } )
                .then( () => {
                  editionAssets[assetId].data = url;
                } )
                .then( res1 )
                .catch( rej1 );
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
        } ) );
      }, Promise.resolve() );
    } )
    .then( () => {
      const finalAssets = {
        ...initialProduction,
        assets: editionAssets
      };

      return writeFile( `${jobTempFolderPath}/production.json`, JSON.stringify( finalAssets ), 'utf8' );
    } )

    .then( () => {
      if ( typeof onFeedback === 'function' ) {
        onFeedback( {
          type: 'info',
          message: 'building website'
        } );
      }
      const nav = utils.buildNav( { production: initialProduction, edition, locale } ).concat( utils.getAdditionalRoutes() )
        .map( ( navItem, navItemIndex ) => {
          return {
            ...navItem,
            route: routeItemToUrl( navItem, navItemIndex ),
          };
        } );
      return nav.reduce( ( cur, navItem ) =>
        cur.then( () => new Promise( ( res1, rej1 ) => {
          const { route, viewId, routeClass, routeParams } = navItem;
          const routeFolder = `${jobTempFolderPath}${route.split( '?' )[0]}`;
          const Comp = template.components.Edition;
          let htmlContent = '';
          try {
            htmlContent = renderToString(
              <StaticRouter
                context={ {} }
                location={ navItem.route }
              >
                <Comp
                  viewId={ viewId }
                  viewClass={ routeClass }
                  viewParams={ routeParams }
                  production={ loadedProduction }
                  edition={ edition }
                  locale={ locale }
                  previewMode
                  contextualizers={ peritextConfig.contextualizers }
                />
              </StaticRouter>
            );

            /*
             * if ( routeClass === 'sections' )
             * console.log( 'html content', htmlContent );
             */
          }
          catch ( e ) {
            console.error( 'e', e );/* eslint no-console : 0 */
          }

          const head = renderToStaticMarkup(
            utils.renderHeadFromRouteItem( { production: loadedProduction, edition, item: navItem } )
            );
          const { data = {} } = edition;
          const { allowAnnotation = false } = data;

          const html = `<!DOCTYPE html>
<html>
      ${head}
      <style>
        .static-wrapper{
          opacity: 0;
          transitions: all .5s ease;
        }
      </style>
      <body>
        <div id="mount">
          <div class="static-wrapper">
            ${htmlContent}
          </div>
        </div>
        <style>
        .static-wrapper{
          opacity: 1;
        }
      </style>
    ${allowAnnotation ? '<script src="https://hypothes.is/embed.js" async></script>' : ''}
        <script>
                function loadJSON(callback) {  

                var xobj = new XMLHttpRequest();
                    xobj.overrideMimeType("application/json");
                xobj.open('GET', '/production.json', true); // Replace 'my_data' with the path to your file
                xobj.onreadystatechange = function () {
                      if (xobj.readyState == 4 && xobj.status == "200") {
                        // Required use of an anonymous callback as .open will NOT return a value but simply returns undefined in asynchronous mode
                        callback(JSON.parse(xobj.responseText));
                      }
                };
                xobj.send(null);  
             }
            var __production;
            window.toWatch = {production: window.__production}
            loadJSON(function(data) {
              __production = data;
              window.toWatch.production = data;
            })

            var __editionId = "${edition.id}";
            var __locale = ${JSON.stringify( locale )} || {};
            var __useBrowserRouter = true;
            ${
              Object.keys( config )
              .map( ( key ) => `var ${key} = "${config[key]}"` )
              .join( '\n' )
            }
        </script>
        <script type="text/javascript" src="/bundle.js"></script>
        <script src="https://maps.googleapis.com/maps/api/js?key=AIzaSyBBSfycBqpNHM0ieFYBhNW24h7mgQ2CTjQ&libraries=places"></script>
        <script src="https://cdn.jsdelivr.net/npm/css-vars-ponyfill@1"></script>
      </body>
    </html>`;
          ensureDir( routeFolder )
            .then( () => writeFile( `${routeFolder}/index.html`, html, 'utf8' ) )
            .then( res1 )
            .catch( rej1 );
        } ) )
      , Promise.resolve() );

    } )

    /**
     * Creating and filling the archive
     */
    .then( () => {
      if ( typeof onFeedback === 'function' ) {
        onFeedback( {
          type: 'info',
          message: 'creating archive'
        } );
      }
      return new Promise( ( res1, rej1 ) => {
        const output = createWriteStream( outputPath );
        const archive = archiver( 'zip', {
          zlib: { level: 9 } // Sets the compression level.
        } );
        archive.directory( jobTempFolderPath, false );

        /*
         * listen for all archive data to be written
         * 'close' event is fired only when a file descriptor is involved
         */
        output.on( 'close', function() {
          if ( typeof onFeedback === 'function' ) {
            onFeedback( {
              type: 'success',
              message: 'archive created'
            } );
          }
          res1();
        } );

        /*
         * This event is fired when the data source is drained no matter what was the data source.
         * It is not part of this library but rather from the NodeJS Stream API.
         * @see: https://nodejs.org/api/stream.html#stream_event_end
         */
        output.on( 'end', function() {
          if ( typeof onFeedback === 'function' ) {
            onFeedback( {
              type: 'success',
              message: 'archive created'
            } );
          }
          res1();
        } );

        // good practice to catch warnings (ie stat failures and other non-blocking errors)
        archive.on( 'warning', function( err ) {
          if ( err.code === 'ENOENT' ) {
            // log warning
          }
 else {
          if ( typeof onFeedback === 'function' ) {
            onFeedback( {
              type: 'error',
              message: 'archive error',
              payload: {
                error: err
              }
            } );
          }
            // throw error
            rej1( err );
          }
        } );

        // good practice to catch this error explicitly
        archive.on( 'error', function( err ) {
          if ( typeof onFeedback === 'function' ) {
            onFeedback( {
              type: 'error',
              message: 'archive error',
              payload: {
                error: err
              }
            } );
          }
          rej1( err );
          // throw err;
        } );

        // pipe archive data to the file
        archive.pipe( output );

        archive.finalize();
      } );

    } )
    .then( () => {
      if ( typeof onFeedback === 'function' ) {
        onFeedback( {
          type: 'info',
          message: 'cleaning temporary files'
        } );
      }
      remove( jobTempFolderPath );
    } )
    .then( resolve )
    .catch( reject );
  } );
}

module.exports = {
  meta: {
    id: 'single-page-html',
    type: 'peritext-generator',
    name: 'Single HTML page generator',
    generatorType: 'single-page-html',
    outputFormat: 'html',
    interfaceCoverage: [ 'desktop' ]
  },
  generateOutput
};
