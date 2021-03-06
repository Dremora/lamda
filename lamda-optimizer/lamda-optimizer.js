exports = module.exports = function(config, outputdir, callback) {

    var Path = require("path");
    var fs = require("fs");
    var UglifyJS = require("uglify-js");
    var lamda = require("lamda");
    var currentModule;

    GLOBAL.define = lamda.define;
    lamda.require.nodeRequire = require;
    GLOBAL.nodeRequire = require;

    function decreaseDependencyReferenceCounts(config, module, dependencies) {
        var context = lamda.require.s.contexts[currentModule.name];
        var definitions = context.definitions;
        if (dependencies) {
            for (var i = 0; i < dependencies.length; i++) {
                var fullDependencyName = lamda.resolvePath(module, dependencies[i], config);
                if (definitions[fullDependencyName]) {
                   definitions[fullDependencyName].referenceCount--;
                    decreaseDependencyReferenceCounts(config, fullDependencyName, definitions[fullDependencyName].dependencies);

                    if (definitions[fullDependencyName].referenceCount === 0) {
                        delete definitions[fullDependencyName];
                    }
                }
            }
        }
    }

    function excludeDefinitions(config, definitions) {
        for (var exportDef in definitions) {
            if (currentModule.exclude.indexOf(exportDef) > -1) {
                decreaseDependencyReferenceCounts(config, exportDef, definitions[exportDef].dependencies)
                delete definitions[exportDef];
            }
        }
        delete definitions["require"];
        delete definitions["exports"];
        delete definitions["module"];
    }

    function write(module, definitions) {
        var output = "";
        Object.keys(definitions).reverse().forEach(function(defName){
            console.log("\t"+defName);
            var definition = definitions[defName];
            if (typeof definition === "string") {
                output += definition;
                return;
            }

            if (definition.name === undefined) {
                console.log("ERROR: " + defName + " is undefined.\n Confirm file is wrapped as an AMD module and that any defined name matches the file name.");
                process.exit(1);
            }

            output += "define('"+definition.name+"',";
            if (definition.dependencies) {
                var dependencies = definition.dependencies;
                output += "[";
                for (var i = 0; i < dependencies.length; i++) {
                    output += "'"+dependencies[i]+"'";
                    if (i !== dependencies.length - 1) {
                        output += ",";
                    }
                }
                output += "]";
            }

            if (definition.callback && typeof definition.callback === "function") {
                output += "," + definition.callback.toString();
            } else if (definition.callback && typeof definition.callback === "object") {
                output += "," + JSON.stringify(definition.callback);
            }
            output += ");\n\n";
        });

        var outputFile = module.name;
        if (config.packages) {
            for (var i = 0; i < config.packages.length; i++) {
                if (config.packages[i].name === module.name) {
                    outputFile += "/main";
                }
            }
        }

        recursiveMkdir(outputdir + "/" + outputFile.substring(0, outputFile.lastIndexOf("/")));
        if (config.minify) {
            output = UglifyJS.minify(output, {fromString: true}).code;
        }

        if (config.header) {
            output = config.header + "\n" + output;
        }



        fs.writeFileSync(outputdir + "/" + outputFile +".js", output, "utf8");
    }

    function optimize(module) {
        module.location = module.location || module.name;
        module.exclude = module.exclude || [];

        currentModule = module;
        var localConfig = lamda.merge(config, {
            context: module.name,
            isBuild: true,
            inlineText: true
        });

        // Begin
        lamda.createContext(localConfig);
        config.modules.forEach(function(mod) {
            if (mod.name !== mod.location) {
                lamda.require.s.contexts[localConfig.context].definitions[mod.name] = {
                    name: mod.name,
                    dependencies: [mod.location],
                    callback: function(main) {
                        return main;
                    }
                }
            }
        });

        console.log("\n\t"+module.name+"\n\t----------------------");
        lamda.require(localConfig, [module.location])

        excludeDefinitions(localConfig, lamda.require.s.contexts[module.name].definitions);
        write(module, lamda.require.s.contexts[module.name].definitions);
        console.log("\n");
    }

    function recursiveMkdir(path, position) {
        var osSep = process.platform === 'win32' ? '\\' : '/';
        var parts = Path.normalize(path).split(osSep);
        position = position || 0;

        if (position >= parts.length) {
            return true;
        }

        var directory = parts.slice(0, position + 1).join(osSep) || osSep;
        if (!fs.existsSync(directory)) {
            fs.mkdirSync(directory);
        }
        recursiveMkdir(path, position + 1);
    }

    config.modules.forEach(optimize);
    callback();

}