const fs = require('fs-extra'),
    path = require('path'),
    pug = require('pug'),
    chokidar = require('chokidar'),
    glob = require("glob"),
    filter = require('lodash/filter'),
    orderBy = require('lodash/orderBy');



module.exports = (function(options = {}) {

    // get app root
    let appRootDir = require('app-root-dir').get();

    // make other paths needed
    let templatesFolder = path.join(appRootDir, './src/templates/'),
        rawFolder = options.dir ? path.resolve(options.dir) : path.join(templatesFolder, './raw'),
        outputFolder = options.out ? path.resolve(options.out) : path.join(templatesFolder, 'compiled'),
        allPugFilesCollection = {},
        recentlyCompiledFilesArray = [],
        recompileAfter = options.wait || 1000,
        outputParentDir;


    if (!fs.pathExistsSync(rawFolder)) {
        console.log(`The path ${rawFolder} does not exist!`);
        return;
    }

    // 
    outputParentDir = path.dirname(outputFolder);

    if (!fs.pathExistsSync(outputParentDir)) {
        console.log(`The path "${outputParentDir}" where the output directory "${path.basename(outputFolder)}" does not exist!`);
        return;
    }


    // start 
    start();


    function start() {

        // Get all pug files...
        get_pug_files();

        // make funcs function 
        make_funcs_file();

        // watch folder
        watch_raw_folder();

    }

    function get_pug_files() {

        // log
        console.log(`***********************************       \nRunningPug Compiler       \n***********************************`);

        // read all pug files in raw folder
        let pugFilesInRawFolder = glob.sync(rawFolder + '/**/*.pug')
            .map(file => {
                // get depth of the file path relative to the raw folder
                return {
                    file: path.normalize(file),
                    depth: path.relative(rawFolder, file).split(path.sep).length
                }
            })

        // We order the files by the depth so that we can start working on files higher up the path
        pugFilesInRawFolder = orderBy(pugFilesInRawFolder, 'depth');

        // loop
        for (let fileObj of pugFilesInRawFolder) {

            // console.log(fileObj.file);
            // if file is in the raw folder
            if (fileObj.depth == 1) {
                allPugFilesCollection[fileObj.file] = {
                    file: fileObj.file,
                    parent: fileObj.file,
                    isInclude: false
                };
            }

            //get & parentize all includes
            parentize_includes(fileObj.file);
        }


        allPugFilesCollection = Object.values(allPugFilesCollection);

    }

    // Function loops through all include statements and groups the files being added to their respective parents
    function parentize_includes(fileParentPath) {

        let content = fs.readFileSync(fileParentPath, 'utf-8'),
            regexp = /include\s+(.+)/g,
            pathToFile,
            fileAncestors,
            file;


        // get all includes
        const matches = content.matchAll(regexp);

        for (const match of matches) {
            // console.log(match[1]);
            file = match[1];

            // is does supposed fileParent also have any parents out there
            fileAncestors = get_file_parents(fileParentPath);
            // make full path to file
            pathToFile = path.join(path.dirname(fileParentPath), file);


            if (fileAncestors.length) {
                for (let ancestors of fileAncestors) {
                    // set ancestor as parent
                    // console.log(ancestors);
                    allPugFilesCollection[`${pathToFile}:${fileParentPath}`] = {
                        file: pathToFile,
                        parent: ancestors.parent,
                        isInclude: true
                    };
                }
            } else {
                // Indicate that the file has a parent
                allPugFilesCollection[`${pathToFile}:${fileParentPath}`] = {
                    file: pathToFile,
                    parent: fileParentPath,
                    isInclude: true
                };
            }

        }

    }


    function get_file_parents(file) {

        let pugFilesCollection = Array.isArray(allPugFilesCollection) ? allPugFilesCollection : Object.values(allPugFilesCollection);
        // pugFilesCollection
        let parents = filter(pugFilesCollection, { file, isInclude: true });

        // return all the parents 
        return parents;
    }

    function watch_raw_folder() {

        let parents;

        chokidar.watch(path.join(rawFolder, "/**/*.pug"), {
            // ignoreInitial: true,
            awaitWriteFinish: {
                stabilityThreshold: 1000,
                pollInterval: 100
            },
        }).on('all', (evt, file) => {

            // When files change, we only compile the parents if the file is an include file
            parents = get_file_parents(file);

            // id parents, loop through and compile each
            if (parents.length > 0) {
                for (parentObj of parents) {
                    compile_file(parentObj.parent, true);
                }
            } else {
                // else compile file
                compile_file(file);
            }

        });

    }

    function compile_file(filePath, isParent) {

        // Ensure file exists
        if (!fs.existsSync(filePath)) {
            console.log(`The Pug File ${filePath} has either been moved or removed.`);
            return
        }

        // console.log(recentlyCompiledFilesArray);
        let isRecentlyCompiled = filter(recentlyCompiledFilesArray, { file: filePath })
            .map(o => Date.now() - o.time)
            .filter(d => d <= recompileAfter).length > 0;

        if (isRecentlyCompiled) {
            return;
        }



        let compiled,
            fileName = path.basename(filePath);

        // log
        console.log(`>> Pug Compiling${isParent?' (PARENT)':''} ${fileName}`);

        //compile file to client usable code
        try {
            compiled = pug.compileFileClient(filePath, { compileDebug: false }).toString();

            // Replace PUG Files
            let exported = compiled.replace(/([\w\W]+?)(function template\([\w\W]+)/, "$2");
            // Add import, and export statements 
            exported = `
        // Import Needed Pug Files  
        import {pug_escape ,pug_rethrow, pug_match_html} from './__funcs.js'; \n\n    
        ${exported}
        export default template; `;

            // the Output File
            let outputFile = path.join(outputFolder, fileName.replace('.pug', '.js'));

            // console.log(exported);
            fs.writeFileSync(outputFile, exported);

        } catch (error) {
            console.log(error.message);
        }

        // mark as recently compiled
        recentlyCompiledFilesArray.push({
            file: filePath,
            time: Date.now()
        })

        // remove very old values
        recentlyCompiledFilesArray = recentlyCompiledFilesArray.slice(-20)


    }


    function make_funcs_file() {
        // ensure output directory exists
        fs.ensureDirSync(outputFolder);
        // file path
        let file = path.join(outputFolder, '__funcs.js');

        fs.writeFileSync(file, pug_funcs_code());
    }

    function pug_funcs_code() {
        return `
export let pug_escape = function pug_escape(e){var a=""+e,t=pug_match_html.exec(a);if(!t)return e;var r,c,n,s="";for(r=t.index,c=0;r<a.length;r++){switch(a.charCodeAt(r)){case 34:n="&quot;";break;case 38:n="&amp;";break;case 60:n="&lt;";break;case 62:n="&gt;";break;default:continue}c!==r&&(s+=a.substring(c,r)),c=r+1,s+=n}return c!==r?s+a.substring(c,r):s}

export let pug_match_html=/["&<>]/;

export let pug_rethrow = function pug_rethrow(e,n,r,t){if(!(e instanceof Error))throw e;if(!("undefined"==typeof window&&n||t))throw e.message+=" on line "+r,e;var o,a,i,s;try{t=t||require("fs").readFileSync(n,{encoding:"utf8"}),o=3,a=t.split("\\n"),i=Math.max(r-o,0),s=Math.min(a.length,r+o)}catch(t){return e.message+=" - could not read from "+n+" ("+t.message+")",void pug_rethrow(e,null,r)}o=a.slice(i,s).map(function(e,n){var t=n+i+1;return(t==r?"  > ":"    ")+t+"| "+e}).join("\\n"),e.path=n;try{e.message=(n||"Pug")+":"+r+"\\n"+o+"\\n\\n"+e.message}catch(e){}throw e}
    `
    }

})