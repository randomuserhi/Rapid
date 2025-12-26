// TODO(randomuserhi): Cleanup and comment code...
// TODO(randomuserhi): Convert uses of statement.ast to something else... 
//                     I think not using statement.ast is more performant

import type * as BabelCoreNamespace from '@babel/core';
import type { PluginObj } from '@babel/core';
import type * as BabelTypesNamespace from '@babel/types';

export type Babel = typeof BabelCoreNamespace;
export type BabelTypes = typeof BabelTypesNamespace;

import { statement, statements } from "@babel/template";

export const ASL_EXPORTS_KEYWORD = "__ASL_exports";
export const ASL_REQUIRE_KEYWORD = "__ASL_require";

export default function (babel: Babel): PluginObj {
    const t = babel.types;

    return {
        visitor: {
            Program(path) {
                // Track if we need `__esModule` tag for export interop (only required for default exports)
                let __esModuleInterop = false;

                // Include ASL helper functions
                let exportStarIdentifier: BabelTypesNamespace.Identifier | undefined = undefined; 
                const createExportStarHelper = () => {
                    // export * from './module'
                    if (exportStarIdentifier === undefined) {
                        exportStarIdentifier = path.scope.generateUidIdentifier("ASL_exportStar");
                        path.unshiftContainer("body", statements.ast`const ${exportStarIdentifier} = (this && this.${exportStarIdentifier}) || function(m, exports) {
                            for (var p in m) if (p !== "default") exports[p] = m[p];
                        };`);
                    }
                    return exportStarIdentifier;
                };

                let importDefaultIdentifier: BabelTypesNamespace.Identifier | undefined = undefined; 
                const createImportDefaultHelper = () => {
                    // import def from './module'
                    if (importDefaultIdentifier === undefined) {
                        importDefaultIdentifier = path.scope.generateUidIdentifier("ASL_importDefault");
                        path.unshiftContainer("body", statements.ast`const ${importDefaultIdentifier} = (this && this.${importDefaultIdentifier}) || function(mod) {
                            return (mod && mod.__esModule) ? mod : { default: mod };
                        };`);
                    }
                    return importDefaultIdentifier;
                };

                // Ammend imports
                path.traverse({
                    ImportDeclaration(path) {
                        const rebind = (name: string, expression: BabelCoreNamespace.types.MemberExpression | BabelCoreNamespace.types.Identifier) => {
                            path.scope.bindings[name].referencePaths.forEach((refPath) => {
                                if (refPath === path) return;
                                refPath.replaceWith(expression);
                            });
                        };
                        
                        const source = path.node.source.value;

                        let moduleId: BabelTypesNamespace.Identifier | undefined = undefined; 
                        const createModuleDecl = () => {
                            if (moduleId === undefined) {
                                moduleId = path.scope.generateUidIdentifier("ASL_module");
                                const importExpression = statement.ast`const ${moduleId} = (await ${ASL_REQUIRE_KEYWORD}(${t.stringLiteral(source)})).exports`;
                                importExpression.loc = path.node.loc; // Generate mapping for source maps (this gets interpreted as the import statement)
                                path.insertBefore(importExpression);
                            }
                            return moduleId;
                        };

                        let moduleDefaultId: BabelTypesNamespace.Identifier | undefined = undefined; 
                        const createModuleDefaultDecl = () => {
                            if (moduleDefaultId === undefined) {
                                const decl = createModuleDecl();
                                moduleDefaultId = path.scope.generateUidIdentifier(`${decl.name}_default`);
                                path.insertBefore(statement.ast`const ${moduleDefaultId} = ${createImportDefaultHelper()}(${createModuleDecl()})`);
                            }
                            return moduleDefaultId;
                        };

                        for (const specifier of path.node.specifiers) {
                            const localName = specifier.local.name;

                            switch (specifier.type) {
                            case "ImportDefaultSpecifier": {
                                rebind(localName, t.memberExpression(
                                    createModuleDefaultDecl(),
                                    t.identifier("default")
                                ));
                            } break;
                            case "ImportSpecifier": {
                                rebind(localName, t.memberExpression(
                                    createModuleDecl(),
                                    specifier.imported
                                ));
                            } break;
                            case "ImportNamespaceSpecifier": {
                                rebind(localName, createModuleDecl());
                            } break;
                            }
                        }

                        path.remove();
                    },
                    CallExpression(path) {
                        if (t.isImport(path.node.callee)) {
                            path.replaceWith(
                                t.callExpression(t.identifier(ASL_REQUIRE_KEYWORD), path.node.arguments)
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
                                    t.identifier(ASL_EXPORTS_KEYWORD),
                                    t.identifier(name)
                                ));
                            });
                            path.scope.bindings[name].constantViolations.forEach((refPath) => {
                                if (refPath === path) return;
                                if (t.isAssignmentExpression(refPath.node)) {
                                    refPath.get("left").replaceWith(t.memberExpression(
                                        t.identifier(ASL_EXPORTS_KEYWORD),
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
                                    t.memberExpression(t.identifier(ASL_EXPORTS_KEYWORD), t.identifier(id.name)),
                                    t.functionExpression(undefined, params, body, generator, async)
                                )));

                                rebind(id.name);
                            } else if (t.isVariableDeclaration(declaration)) {
                                path.replaceWithMultiple(declaration.declarations.map((declarator) => {
                                    if (!t.isIdentifier(declarator.id)) throw new Error("Unsupported declarator pattern");

                                    if (declarator.init) {
                                        return t.expressionStatement(t.assignmentExpression(
                                            '=',
                                            t.memberExpression(t.identifier(ASL_EXPORTS_KEYWORD), t.identifier(declarator.id.name)),
                                            declarator.init
                                        ));
                                    }
                                    return t.expressionStatement(t.assignmentExpression(
                                        '=',
                                        t.memberExpression(t.identifier(ASL_EXPORTS_KEYWORD), t.identifier(declarator.id.name)),
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
                                    t.memberExpression(t.identifier(ASL_EXPORTS_KEYWORD), t.identifier(id.name)),
                                    t.classExpression(undefined, superClass, body, decorators)
                                )));

                                rebind(id.name);
                            } else {
                                const specifiers = path.node.specifiers;
                                const source = path.node.source;

                                let moduleId: BabelTypesNamespace.Identifier | undefined = undefined; 
                                const createModuleDecl = () => {
                                    if (moduleId === undefined) {
                                        if (!source) throw new Error("Requires a valid source module");

                                        moduleId = path.scope.generateUidIdentifier("ASL_module");
                                        const importExpression = statement.ast`const ${moduleId} = (await ${ASL_REQUIRE_KEYWORD}(${source})).exports`;
                                        importExpression.loc = path.node.loc; // Generate mapping for source maps (this gets interpreted as the import statement)
                                        path.insertBefore(importExpression);
                                    }
                                    return moduleId;
                                };

                                let moduleDefaultId: BabelTypesNamespace.Identifier | undefined = undefined; 
                                const createModuleDefaultDecl = () => {
                                    __esModuleInterop = true;
                                    if (moduleDefaultId === undefined) {
                                        const decl = createModuleDecl();
                                        moduleDefaultId = path.scope.generateUidIdentifier(`${decl.name}_default`);
                                        path.insertBefore(statement.ast`const ${moduleDefaultId} = ${createImportDefaultHelper()}(${createModuleDecl()})`);
                                    }
                                    return moduleDefaultId;
                                };

                                path.replaceWithMultiple(specifiers.map((specifier) => {
                                    switch (specifier.type) {
                                    case "ExportSpecifier": {
                                        if (!source) {
                                            return t.expressionStatement(t.assignmentExpression(
                                                '=',
                                                t.memberExpression(t.identifier(ASL_EXPORTS_KEYWORD), specifier.exported),
                                                specifier.local
                                            ));
                                        } else {
                                            const exportedName = t.isIdentifier(specifier.exported) ? specifier.exported.name : specifier.exported.value;
                                            if (exportedName !== "default") {
                                                return t.expressionStatement(t.assignmentExpression(
                                                    '=',
                                                    t.memberExpression(t.identifier(ASL_EXPORTS_KEYWORD), specifier.exported),
                                                    t.memberExpression(createModuleDecl(), specifier.exported)
                                                ));
                                            } else {
                                                return statement.ast`${ASL_EXPORTS_KEYWORD}.default = ${createModuleDefaultDecl()}.default;`;
                                            }
                                        }
                                    }
                                    case "ExportNamespaceSpecifier": {
                                        return statement.ast`${ASL_EXPORTS_KEYWORD}.${specifier.exported} = ${createModuleDecl()};`;
                                    }
                                    case "ExportDefaultSpecifier": {
                                        return statement.ast`${ASL_EXPORTS_KEYWORD}.default = ${createModuleDefaultDecl}.default;`;
                                    }
                                    }
                                }));
                            }
                        } break;
                        case "ExportDefaultDeclaration": {
                            __esModuleInterop = true;

                            const declaration = path.node.declaration;

                            if (t.isFunctionDeclaration(declaration)) {
                                const { id, params, body, generator, async } = declaration;

                                // Keep function name if present (otherwise anonymous)
                                path.replaceWith(t.expressionStatement(
                                    t.assignmentExpression(
                                        '=',
                                        t.memberExpression(t.identifier(ASL_EXPORTS_KEYWORD), t.identifier("default")),
                                        t.functionExpression(id, params, body, generator, async)
                                    )
                                ));
                            } else if (t.isClassDeclaration(declaration)) {
                                const { id, superClass, body, decorators } = declaration;

                                path.replaceWith(t.expressionStatement(
                                    t.assignmentExpression(
                                        '=',
                                        t.memberExpression(t.identifier(ASL_EXPORTS_KEYWORD), t.identifier("default")),
                                        t.classExpression(id, superClass, body, decorators)
                                    )
                                ));
                            } else if (t.isExpression(declaration)) {
                                path.replaceWith(t.expressionStatement(
                                    t.assignmentExpression(
                                        '=',
                                        t.memberExpression(t.identifier(ASL_EXPORTS_KEYWORD), t.identifier("default")),
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

                            // export * from './module'
                            path.replaceWithMultiple(statements.ast`${createExportStarHelper()}((await ${ASL_REQUIRE_KEYWORD}("${source}")).exports, ${ASL_EXPORTS_KEYWORD});`);
                        } break;
                        }
                    }
                });

                if (__esModuleInterop) {
                    // Emit `__esModule` tag following typescript and babel ES module interop rules
                    path.unshiftContainer("body", statements.ast`Object.defineProperty(${ASL_EXPORTS_KEYWORD}, "__esModule", { value: true });`);
                }
            }
        },
    };
};
