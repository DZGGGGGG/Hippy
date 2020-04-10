const fs          = require('fs');
const path        = require('path');
const readline    = require('readline');
// FIXME: I have no idea the config have no effect in eslintrc, disabled the rule here.
/* eslint-disable-next-line import/no-extraneous-dependencies */
const babel       = require('@babel/core');
const package     = require('../../package.json');

/**
 * Babel configuration for iOS compiling
 */
const iOSBabelConfig = {
  presets: [
    [
      '@babel/env',
      {
        targets: {
          safari: '8',
        },
      },
    ],
  ],
};

/**
 * Code header and content
 */
const CodePieces = {
  header(platform) {
    return `/*
* native-source-code.cc for Hippy ${platform}
*
* The file is generated by js2cpp for Hippy.
* js2cpp is maintenance by ${package.author}
* Copyright © 2018-${new Date().getFullYear()} Tencent. All rights reserved.
*
* Generated at ${new Date().toString()}.
* DO NOT EDIT IT.
*/
#include "core/napi/native-source-code.h"
#include <unordered_map>
#include "core/base/macros.h"

// clang-format off

namespace {`;
  },
  piece1: `
}  // namespace

namespace hippy {
  static const std::unordered_map<std::string, NativeSourceCode> global_base_js_source_map{
    {"bootstrap.js", {k_bootstrap, arraysize(k_bootstrap) - 1}},  // NOLINT
    {"hippy.js", {k_hippy, arraysize(k_hippy) - 1}},  // NOLINT`,
  piece2: `
  };
  const NativeSourceCode GetNativeSourceCode(const std::string& filename) {
    const auto it = global_base_js_source_map.find(filename);
    return it != global_base_js_source_map.cend() ? it->second : NativeSourceCode{};
  }
}  // namespace hippy
`,
};

/**
 * Initial the codegit st buffer header and footer.
 */
const wrapperBeginBuffer = Buffer.from('(function(exports, require, internalBinding) {');
const wraperBeginByteArr = [];
for (let i = 0; i < wrapperBeginBuffer.length; i += 1) {
  wraperBeginByteArr.push(wrapperBeginBuffer[i]);
}

const wrapperEndBuffer = Buffer.from('});');
const wraperEndByteArr = [];
for (let i = 0; i < wrapperEndBuffer.length; i += 1) {
  wraperEndByteArr.push(wrapperEndBuffer[i]);
}

/**
 * Get the core js files list for specific platform.
 *
 * @param {android|ios} platform - specific platform.
 */
function getAllRequiredFiles(platform) {
  return new Promise((resole) => {
    const rl = readline.createInterface({
      input: fs.createReadStream(path.resolve(__dirname, `../../core/js/entry/${platform}/hippy.js`)),
    });
    const filePaths = [
      path.resolve(__dirname, './bootstrap.js'),
      path.resolve(__dirname, `../../core/js/entry/${platform}/hippy.js`),
      path.resolve(__dirname, '../../core/js/modules/ExceptionHandle.js'),
    ];

    rl.on('line', (line) => {
      if (line.split('//')[0].indexOf('require') > -1) {
        const entry = line.split("('")[1].split("')")[0];
        filePaths.push(path.resolve(__dirname, `../../core/js/entry/${platform}/${entry}`));
      }
    });
    rl.on('close', () => {
      resole(filePaths);
    });
  });
}

/**
 * Read the file content to be a buffer.
 *
 * @param {android|ios} platform - specific platform.
 * @param {string} filePath - the file path will read.
 */
function readFileToBuffer(platform, filePath) {
  switch (platform) {
    case 'android': {
      return fs.readFileSync(filePath);
    }
    case 'ios': {
      const code = fs.readFileSync(filePath).toString();
      const compiled = babel.transform(code, iOSBabelConfig);
      return Buffer.from(compiled.code);
    }
    default:
      return null;
  }
}

/**
 * Read the js files and generate the core cpp files.
 *
 * @param {android|ios} platform - specific platform.
 * @param {string} buildDirPath - output directory.
 */
function generateCpp(platform, buildDirPath) {
  let code = CodePieces.header(platform);

  getAllRequiredFiles(platform).then((filesArr) => {
    filesArr.forEach((filePath) => {
      const fileName = path.basename(filePath, '.js');
      const fileBuffer = readFileToBuffer(platform, filePath);
      const byteArr = [];
      for (let i = 0; i < fileBuffer.length; i += 1) {
        byteArr.push(fileBuffer[i]);
      }
      if (fileName === 'bootstrap' || fileName === 'ExceptionHandle') {
        code += `
  const uint8_t k_${fileName}[] = { ${byteArr.join(',')},0 };  // NOLINT`;
      } else {
        code += `
  const uint8_t k_${fileName}[] = { ${wraperBeginByteArr.join(',')},${byteArr.join(',')},${wraperEndByteArr.join(',')},0 };  // NOLINT`;
      }
    });

    code += CodePieces.piece1;

    for (let i = 2; i < filesArr.length; i += 1) {
      const fileName = path.basename(filesArr[i], '.js');
      code += `
      {"${fileName}.js", {k_${fileName}, arraysize(k_${fileName}) - 1}},  // NOLINT`;
    }

    code += CodePieces.piece2;

    const targetPath = `${buildDirPath}/native-source-code-${platform}.cc`;
    fs.writeFile(targetPath, code, (err) => {
      if (err) {
        /* eslint-disable-next-line no-console */
        console.log('[writeFile error] : ', err);
        return;
      }
      /* eslint-disable-next-line no-console */
      console.log(`${platform} convert success, output ${targetPath}`);
    });
  });
}

// Start to work
generateCpp('ios', path.resolve(__dirname, '../../core/napi/jsc'));
generateCpp('android', path.resolve(__dirname, '../../core/napi/v8/'));
