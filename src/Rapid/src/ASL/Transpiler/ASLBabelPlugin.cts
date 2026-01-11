// TODO(randomuserhi): Cleanup and comment code...
// TODO(randomuserhi): Convert uses of statement.ast to something else... 
//                     I think not using statement.ast is more performant

import type * as BabelCoreNamespace from '@babel/core';
import type { PluginObj } from '@babel/core';
import type * as BabelTypesNamespace from '@babel/types';

export type Babel = typeof BabelCoreNamespace;
export type BabelTypes = typeof BabelTypesNamespace;

import { statement } from "@babel/template";

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
                        path.unshiftContainer("body", statement.ast`const ${exportStarIdentifier} = (this && this.${exportStarIdentifier}) || function(m, exports) {
                            for (var p in m) if (p !== "default") exports[p] = m[p];
                        };`);
                    }
                    return exportStarIdentifier;
                };

                let isBrowserIdentifier: BabelTypesNamespace.Identifier | undefined = undefined;
                let importDefaultIdentifier: BabelTypesNamespace.Identifier | undefined = undefined; 
                const createImportDefaultHelper = () => {
                    if (isBrowserIdentifier === undefined) {
                        isBrowserIdentifier = path.scope.generateUidIdentifier("ASL_isBrowser");
                        path.unshiftContainer("body", statement.ast`const ${isBrowserIdentifier} = typeof window !== "undefined" && typeof window.document !== "undefined";`);
                    }
                    
                    // import def from './module'
                    if (importDefaultIdentifier === undefined) {
                        importDefaultIdentifier = path.scope.generateUidIdentifier("ASL_importDefault");
                        path.unshiftContainer("body", statement.ast`const ${importDefaultIdentifier} = (this && this.${importDefaultIdentifier}) || function(mod) {
                            if (!${isBrowserIdentifier} || Object.isExtensible(mod)) {
                                return (mod && mod.__esModule) ? mod : { default: mod };
                            } else {
                                return mod;
                            }
                        };`);
                    }
                    return importDefaultIdentifier;
                };

                // Defer rebinding and removal until AFTER we create new nodes so we can recrawl and grab created references
                const rebindJobs: (() => void)[] = [];
                const nodeRemoveJobs: (() => void)[] = [];

                // Ammend imports
                path.traverse({
                    ImportDeclaration(path) {
                        const rebind = (name: string, expression: BabelCoreNamespace.types.MemberExpression | BabelCoreNamespace.types.Identifier) => {
                            rebindJobs.push(() => {
                                path.scope.bindings[name].referencePaths.forEach((refPath) => {
                                    if (refPath === path) return;

                                    // Skip export specifiers
                                    if (
                                        refPath.parentPath?.isExportSpecifier() &&
                                        refPath.parentKey === "local"
                                    ) {
                                        return;
                                    }

                                    const node = t.cloneNode(expression);
                                    node.loc = refPath.node.loc;
                                    refPath.replaceWith(node);
                                });
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

                        nodeRemoveJobs.push(() => path.remove());
                    },
                    CallExpression(path) {
                        if (t.isImport(path.node.callee)) {
                            const node = t.callExpression(t.identifier(ASL_REQUIRE_KEYWORD), path.node.arguments);
                            node.loc = path.node.loc;
                            path.replaceWith(node);
                        }
                    },
                });

                // Handle exports
                path.traverse({
                    ExportDeclaration(path) {
                        const rebind = (name: string, toDefault: boolean = false) => {
                            rebindJobs.push(() => {
                                path.scope.bindings[name].referencePaths.forEach((refPath) => {
                                    if (refPath === path) return;

                                    // Skip export specifiers
                                    if (
                                        refPath.parentPath?.isExportSpecifier() &&
                                        refPath.parentKey === "local"
                                    ) {
                                        return;
                                    }

                                    const node = t.memberExpression(
                                        t.identifier(ASL_EXPORTS_KEYWORD),
                                        t.identifier(toDefault ? "default" : name)
                                    );
                                    node.loc = refPath.node.loc;
                                    refPath.replaceWith(node);
                                });
                                path.scope.bindings[name].constantViolations.forEach((refPath) => {
                                    if (refPath === path) return;

                                    // Skip export specifiers
                                    if (
                                        refPath.parentPath?.isExportSpecifier() &&
                                        refPath.parentKey === "local"
                                    ) {
                                        return;
                                    }

                                    if (t.isAssignmentExpression(refPath.node)) {
                                        const node = t.memberExpression(
                                            t.identifier(ASL_EXPORTS_KEYWORD),
                                            t.identifier(toDefault ? "default" : name)
                                        );
                                        node.loc = refPath.get("left").node.loc;
                                        refPath.get("left").replaceWith(node);
                                    }
                                });
                            });
                        };

                        switch (path.node.type) {
                        case "ExportNamedDeclaration": {
                            const declaration = path.node.declaration;
                            if (t.isFunctionDeclaration(declaration)) {
                                const { id, params, body, generator, async } = declaration;
                                if (!id) throw new Error("Cannot export unnamed function");

                                const node = t.expressionStatement(t.assignmentExpression(
                                    '=',
                                    t.memberExpression(t.identifier(ASL_EXPORTS_KEYWORD), t.identifier(id.name)),
                                    t.functionExpression(undefined, params, body, generator, async)
                                ));
                                node.loc = path.node.loc;

                                path.insertBefore(node);
                                nodeRemoveJobs.push(() => path.remove());

                                rebind(id.name);
                            } else if (t.isVariableDeclaration(declaration)) {
                                path.insertBefore(declaration.declarations.map((declarator) => {
                                    if (!t.isIdentifier(declarator.id)) throw new Error("Unsupported declarator pattern");

                                    if (declarator.init) {
                                        const node = t.expressionStatement(t.assignmentExpression(
                                            '=',
                                            t.memberExpression(t.identifier(ASL_EXPORTS_KEYWORD), t.identifier(declarator.id.name)),
                                            declarator.init
                                        ));
                                        node.loc = declarator.loc;
                                        return node; 
                                    } else {
                                        const node = t.expressionStatement(t.assignmentExpression(
                                            '=',
                                            t.memberExpression(t.identifier(ASL_EXPORTS_KEYWORD), t.identifier(declarator.id.name)),
                                            t.identifier("undefined")
                                        ));
                                        node.loc = declarator.loc;
                                        return node;
                                    }
                                }));
                                nodeRemoveJobs.push(() => path.remove());

                                declaration.declarations.forEach((declarator) => {
                                    if (!t.isIdentifier(declarator.id)) throw new Error("Unsupported declarator pattern");

                                    rebind(declarator.id.name);
                                });
                            } else if (t.isClassDeclaration(declaration)) {
                                const { id, superClass, body, decorators } = declaration;
                                if (!id) throw new Error("Cannot export unnamed class");

                                const node = t.expressionStatement(t.assignmentExpression(
                                    '=',
                                    t.memberExpression(t.identifier(ASL_EXPORTS_KEYWORD), t.identifier(id.name)),
                                    t.classExpression(undefined, superClass, body, decorators)
                                ));
                                node.loc = path.node.loc;

                                path.insertBefore(node);
                                nodeRemoveJobs.push(() => path.remove());

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

                                path.insertBefore(specifiers.map((specifier) => {
                                    switch (specifier.type) {
                                    case "ExportSpecifier": {
                                        if (!source) {
                                            const node = t.expressionStatement(t.assignmentExpression(
                                                '=',
                                                t.memberExpression(t.identifier(ASL_EXPORTS_KEYWORD), specifier.exported),
                                                specifier.local
                                            ));
                                            node.loc = specifier.loc;
                                            return node;
                                        } else {
                                            const exportedName = t.isIdentifier(specifier.exported) ? specifier.exported.name : specifier.exported.value;
                                            if (exportedName === "default") __esModuleInterop = true;

                                            const node = t.expressionStatement(t.assignmentExpression(
                                                '=',
                                                t.memberExpression(t.identifier(ASL_EXPORTS_KEYWORD), specifier.exported),
                                                t.memberExpression(createModuleDecl(), specifier.local)
                                            ));
                                            node.loc = specifier.loc;
                                            return node;
                                        }
                                    }
                                    case "ExportNamespaceSpecifier": {
                                        const node = statement.ast`${ASL_EXPORTS_KEYWORD}.${specifier.exported} = ${createModuleDecl()};`;
                                        node.loc = specifier.loc;
                                        rebind(specifier.exported.name);
                                        return node;
                                    }
                                    case "ExportDefaultSpecifier": {
                                        const node = statement.ast`${ASL_EXPORTS_KEYWORD}.default = ${createModuleDefaultDecl}.default;`;
                                        node.loc = specifier.loc;
                                        return node;
                                    }
                                    }
                                }));
                                nodeRemoveJobs.push(() => path.remove());
                            }
                        } break;
                        case "ExportDefaultDeclaration": {
                            __esModuleInterop = true;

                            const declaration = path.node.declaration;

                            if (t.isFunctionDeclaration(declaration)) {
                                const { id, params, body, generator, async } = declaration;

                                const functionExpression = t.functionExpression(id, params, body, generator, async);
                                functionExpression.loc = declaration.loc;
                                const node = t.expressionStatement(
                                    t.assignmentExpression(
                                        '=',
                                        t.memberExpression(t.identifier(ASL_EXPORTS_KEYWORD), t.identifier("default")),
                                        functionExpression
                                    )
                                );
                                node.loc = path.node.loc;
                                path.insertBefore(node);
                                nodeRemoveJobs.push(() => path.remove());

                                if (id) rebind(id.name, true);
                            } else if (t.isClassDeclaration(declaration)) {
                                const { id, superClass, body, decorators } = declaration;

                                const classExpression = t.classExpression(id, superClass, body, decorators);
                                classExpression.loc = declaration.loc;
                                const node = t.expressionStatement(
                                    t.assignmentExpression(
                                        '=',
                                        t.memberExpression(t.identifier(ASL_EXPORTS_KEYWORD), t.identifier("default")),
                                        classExpression
                                    )
                                );
                                node.loc = path.node.loc;
                                path.insertBefore(node);
                                nodeRemoveJobs.push(() => path.remove());

                                if (id) rebind(id.name, true);
                            } else if (t.isExpression(declaration)) {
                                const node = t.expressionStatement(
                                    t.assignmentExpression(
                                        '=',
                                        t.memberExpression(t.identifier(ASL_EXPORTS_KEYWORD), t.identifier("default")),
                                        declaration
                                    )
                                );
                                node.loc = path.node.loc;
                                path.insertBefore(node);
                                nodeRemoveJobs.push(() => path.remove());
                            } else if (t.isTSDeclareFunction(declaration)) {
                                // Skip Typescript declarations
                                nodeRemoveJobs.push(() => path.remove());
                                return;
                            } else {
                                throw new Error(`Unknown export declaration type.`);
                            }
                        } break;
                        case "ExportAllDeclaration": {
                            // export * from './module'

                            const source = path.node.source.value;

                            const node = statement.ast`${createExportStarHelper()}((await ${ASL_REQUIRE_KEYWORD}("${source}")).exports, ${ASL_EXPORTS_KEYWORD});`;
                            node.loc = path.node.loc;
                            path.insertBefore(node);
                            nodeRemoveJobs.push(() => path.remove());
                        } break;
                        }
                    }
                });

                // Re-crawl to get new references for created nodes
                path.scope.crawl();

                // Rebind jobs
                for (const job of rebindJobs) {
                    job();
                }

                // Remove jobs
                for (const job of nodeRemoveJobs) {
                    job();
                }

                if (__esModuleInterop) {
                    // Emit `__esModule` tag following typescript and babel ES module interop rules
                    path.unshiftContainer("body", statement.ast`Object.defineProperty(${ASL_EXPORTS_KEYWORD}, "__esModule", { value: true });`);
                }
            }
        },
    };
};
