// TODO(randomuserhi): Cleanup and comment code...
// TODO(randomuserhi): Convert uses of statement.ast to something else... 
//                     I think not using statement.ast is more performant

import type * as BabelCoreNamespace from '@babel/core';
import type { PluginObj } from '@babel/core';
import type * as BabelTypesNamespace from '@babel/types';

export type Babel = typeof BabelCoreNamespace;
export type BabelTypes = typeof BabelTypesNamespace;

import { statement, statements } from "@babel/template";


export default function (babel: Babel): PluginObj {
    const t = babel.types;

    return {
        visitor: {
            Program(path) {
                // Include ASL helper functions
                let exportStarIdentifier: BabelTypesNamespace.Identifier | undefined = undefined; 
                const createExportStarHelper = () => {
                    // export * from './module'
                    if (exportStarIdentifier === undefined) {
                        exportStarIdentifier = path.scope.generateUidIdentifier("ASL_ExportStar");
                        path.unshiftContainer("body", statements.ast`const ${exportStarIdentifier.name} = (this && this.${exportStarIdentifier.name}) || function(m, exports) {
                            for (var p in m) if (p !== "default") exports[p] = m[p];
                        };`);
                    }
                };

                // Ammend imports
                path.traverse({
                    ImportDeclaration(path) {
                        const source = path.node.source.value;
                        const specifiers = path.node.specifiers;

                        const defaultSpecifiers = [];
                        const importSpecifiers = [];
                        const namespaceSpecifiers = [];
                        for (const specifier of specifiers) {
                            const localName = specifier.local.name;
                            switch (specifier.type) {
                            case "ImportDefaultSpecifier": {
                                defaultSpecifiers.push(`const ${localName} = await require("${source}", { defaultImport: true })`);
                            } break;
                            case "ImportSpecifier": {
                                if (!t.isIdentifier(specifier.imported)) throw new Error(`Unsupported Identifier - TODO(support this...)`);
                                const importName = specifier.imported.name;
                                importSpecifiers.push(importName === localName ? localName : `${importName}: ${localName}`);
                            } break;
                            case "ImportNamespaceSpecifier": {
                                namespaceSpecifiers.push(`const ${localName} = await require("${source}")`);
                            } break;
                            }
                        }

                        const statements = [];
                        if (defaultSpecifiers.length > 0) statements.push(defaultSpecifiers.join(";\n"));
                        if (importSpecifiers.length > 0) statements.push(`const { ${importSpecifiers.join(", ")} } = await require("${source}")`);
                        if (namespaceSpecifiers.length > 0) statements.push(namespaceSpecifiers.join(";\n"));
                        path.replaceWith(statement.ast`${statements.join(";\n")}`);
                    },
                    CallExpression(path) {
                        if (t.isImport(path.node.callee)) {
                            path.replaceWith(
                                t.callExpression(t.identifier("require"), path.node.arguments)
                            );
                        }
                    },
                });

                // Handle exports
                path.traverse({
                    ExportDeclaration(path) {
                        const rebind = (name: string) => {
                            path.scope.bindings[name].referencePaths.forEach((refPath) => {
                                if (refPath === path) return;
                                refPath.replaceWith(t.memberExpression(
                                    t.identifier("exports"),
                                    t.identifier(name)
                                ));
                            });
                            path.scope.bindings[name].constantViolations.forEach((refPath) => {
                                if (refPath === path) return;
                                if (t.isAssignmentExpression(refPath.node)) {
                                    refPath.get("left").replaceWith(t.memberExpression(
                                        t.identifier("exports"),
                                        t.identifier(name)
                                    ));
                                }
                            });
                        };

                        switch (path.node.type) {
                        case "ExportNamedDeclaration": {
                            const declaration = path.node.declaration;
                            if (t.isFunctionDeclaration(declaration)) {
                                const { id, params, body, generator, async } = declaration;
                                if (!id) throw new Error("Cannot export unnamed function");

                                path.replaceWith(t.expressionStatement(t.assignmentExpression(
                                    '=',
                                    t.memberExpression(t.identifier("exports"), t.identifier(id.name)),
                                    t.functionExpression(undefined, params, body, generator, async)
                                )));

                                rebind(id.name);
                            } else if (t.isVariableDeclaration(declaration)) {
                                path.replaceWithMultiple(declaration.declarations.map((declarator) => {
                                    if (!t.isIdentifier(declarator.id)) throw new Error("Unsupported declarator pattern");

                                    if (declarator.init) {
                                        return t.expressionStatement(t.assignmentExpression(
                                            '=',
                                            t.memberExpression(t.identifier("exports"), t.identifier(declarator.id.name)),
                                            declarator.init
                                        ));
                                    }
                                    return t.expressionStatement(t.assignmentExpression(
                                        '=',
                                        t.memberExpression(t.identifier("exports"), t.identifier(declarator.id.name)),
                                        t.identifier("undefined")
                                    ));
                                }));

                                declaration.declarations.forEach((declarator) => {
                                    if (!t.isIdentifier(declarator.id)) throw new Error("Unsupported declarator pattern");

                                    rebind(declarator.id.name);
                                });
                            } else if (t.isClassDeclaration(declaration)) {
                                const { id, superClass, body, decorators } = declaration;
                                if (!id) throw new Error("Cannot export unnamed class");

                                path.replaceWith(t.expressionStatement(t.assignmentExpression(
                                    '=',
                                    t.memberExpression(t.identifier("exports"), t.identifier(id.name)),
                                    t.classExpression(undefined, superClass, body, decorators)
                                )));

                                rebind(id.name);
                            } else {
                                const specifiers = path.node.specifiers;
                                const source = path.node.source;

                                path.replaceWithMultiple(specifiers.map((specifier) => {
                                    switch (specifier.type) {
                                    case "ExportSpecifier": {
                                        return t.expressionStatement(t.assignmentExpression(
                                            '=',
                                            t.memberExpression(t.identifier("exports"), specifier.exported),
                                            specifier.local
                                        ));
                                    }
                                    case "ExportNamespaceSpecifier": {
                                        if (!source) throw new Error("ExportNamespaceSpecifier requires a source module");

                                        return statement.ast`exports.${specifier.exported.name} = await require("${source.value}");`;
                                    }
                                    case "ExportDefaultSpecifier": {
                                        if (!source) throw new Error("ExportDefaultSpecifier requires a source module");

                                        return statement.ast`exports.default = await require("${source.value}", { defaultImport: true });`;
                                    }
                                    }
                                }));
                            }
                        } break;
                        case "ExportDefaultDeclaration": {
                            const declaration = path.node.declaration;

                            if (t.isFunctionDeclaration(declaration)) {
                                const { id, params, body, generator, async } = declaration;

                                // Keep function name if present (otherwise anonymous)
                                path.replaceWith(t.expressionStatement(
                                    t.assignmentExpression(
                                        '=',
                                        t.memberExpression(t.identifier("exports"), t.identifier("default")),
                                        t.functionExpression(id, params, body, generator, async)
                                    )
                                ));
                            } else if (t.isClassDeclaration(declaration)) {
                                const { id, superClass, body, decorators } = declaration;

                                path.replaceWith(t.expressionStatement(
                                    t.assignmentExpression(
                                        '=',
                                        t.memberExpression(t.identifier("exports"), t.identifier("default")),
                                        t.classExpression(id, superClass, body, decorators)
                                    )
                                ));
                            } else if (t.isExpression(declaration)) {
                                path.replaceWith(t.expressionStatement(
                                    t.assignmentExpression(
                                        '=',
                                        t.memberExpression(t.identifier("exports"), t.identifier("default")),
                                        declaration
                                    )
                                ));
                            } else if (t.isTSDeclareFunction(declaration)) {
                                // Skip Typescript declarations
                                path.remove();
                                return;
                            } else {
                                throw new Error(`Unknown export declaration type.`);
                            }
                        } break;
                        case "ExportAllDeclaration": {
                            const source = path.node.source.value;

                            createExportStarHelper();
                            
                            // export * from './module'
                            path.replaceWithMultiple(statements.ast`${exportStarIdentifier!.name}(await require("${source}"), exports);`);
                        } break;
                        }
                    }
                });
            }
        },
    };
};
