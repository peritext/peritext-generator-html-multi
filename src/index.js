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
  basePath,
  config = {},
} ) {

  const jobId = genId();

  const jobTempFolderPath = `${tempDirPath}/${jobId}`;
  const outputAssetsPath = `${jobTempFolderPath}`;

  const { templates } = peritextConfig;
  const template = templates.find( ( thatT ) => thatT.meta.id === edition.metadata.templateId );
  const utils = template.utils;
  let loadedProduction;
  let editionAssets;
  return new Promise( ( resolve, reject ) => {
    Promise.resolve()
    .then( () =>
      ensureDir( outputAssetsPath )
    )
    .then( () =>
      loadAssetsForEdition( {
        production: initialProduction,
        edition,
        requestAssetData
      } )
    )
    .then( ( loadedAssets ) => {
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
      return Object.keys( editionAssets ).reduce( ( cur, assetId ) => {
        return cur
        .then( () => new Promise( ( res1, rej1 ) => {
          const asset = editionAssets[assetId];
          const mimetype = asset.mimetype;
          const assetDirPath = `${outputAssetsPath}/${asset.id}`;
          const assetFilePath = `${assetDirPath}/${asset.filename}`;
          const url = `/${asset.id}/${asset.filename}`;
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
      const nav = utils.buildNav( { production: initialProduction, edition, locale } ).concat( utils.getAdditionalRoutes() )
        .map( ( navItem, navItemIndex ) => {
          return {
            ...navItem,
            route: utils.routeItemToUrl( navItem, navItemIndex ),
          };
        } );
      return nav.reduce( ( cur, navItem ) =>
        cur.then( () => new Promise( ( res1, rej1 ) => {
          const { route, viewId, viewClass, routeParams } = navItem;
          const routeFolder = `${jobTempFolderPath}${route.split( '?' )[0]}`;
          const Comp = template.components.Production;
          let htmlContent = '';
          try {
            htmlContent = renderToString(
              <StaticRouter>
                <Comp
                  viewId={ viewId }
                  viewClass={ viewClass }
                  viewParams={ routeParams }
                  production={ loadedProduction }
                  edition={ edition }
                  locale={ locale }
                  contextualizers={ peritextConfig.contextualizers }
                />
              </StaticRouter>
            );
          }
          catch ( e ) {
            console.error( 'e', e );/* eslint no-console : 0 */
          }

          const head = renderToStaticMarkup(
            utils.renderHeadFromRouteItem( { production: loadedProduction, edition, item: navItem } )
            );
          const html = `<!DOCTYPE html>
<html>
      ${head}
      <body>
        <div id="mount">
          ${htmlContent}
        </div>
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
          res1();
        } );

        /*
         * This event is fired when the data source is drained no matter what was the data source.
         * It is not part of this library but rather from the NodeJS Stream API.
         * @see: https://nodejs.org/api/stream.html#stream_event_end
         */
        output.on( 'end', function() {
          res1();
        } );

        // good practice to catch warnings (ie stat failures and other non-blocking errors)
        archive.on( 'warning', function( err ) {
          if ( err.code === 'ENOENT' ) {
            // log warning
          }
 else {
            // throw error
            rej1( err );
          }
        } );

        // good practice to catch this error explicitly
        archive.on( 'error', function( err ) {
          rej1( err );
          // throw err;
        } );

        // pipe archive data to the file
        archive.pipe( output );

        archive.finalize();
      } );

    } )
    .then( () =>
      remove( jobTempFolderPath )
    )
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
