#!/usr/bin/env node

'use strict';
const meow = require('meow');

const cli = meow(`
	Usage
	  $ cli.js --dir

	Options
	  --dir, -d  Directory where PUG files are saved
      --out, -o  Directory to output compiled files

	Examples
	  $ cli.js -d ./raw-pug
	  
`, {
    flags: {
        dir: {
            type: 'string',
            alias: 'd'
        },
        out: {
            type: 'string',
            alias: 'o'
        },
        wait: {
            type: 'number',
            default: 1000,
            alias: 'w'

        }
    }
});


require('.')(cli.flags)