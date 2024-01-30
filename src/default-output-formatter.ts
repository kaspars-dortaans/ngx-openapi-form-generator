/**
 * @license
 * Licensed under the MIT License, (“the License”); you may not use this
 * file except in compliance with the License.
 *
 * Copyright (c) 2021 humbertda
 */

import { Project } from 'ts-morph';
import { OutputFormatter } from './output-formatter';
import { EntityForm, GeneratorResult, Property } from './models';
import { OutputFormatterOptions } from './output-formatter-options';
import camelcase from 'camelcase';
import prettier from 'prettier';

export class DefaultOutputFormatter implements OutputFormatter {

    private readonly options: OutputFormatterOptions;

    constructor(opts: Partial<OutputFormatterOptions>) {
        this.options = {
            ...{
                filePrefix: '',
                fileSuffix: '',
                outputFolder: './',
                templatePropertyInterfaceName: 'TemplateProperty',
                tslintOptions: {
                    parser: 'typescript',
                    singleQuote: true,
                    useTabs: false,
                    bracketSpacing: true,
                    tabWidth: 4
                }
            }, ...opts
        };
    }

    public async handleOutput(content: GeneratorResult): Promise<void> {
        const fileMap = new Map<string, string>();
        const properties: Property[] = [];
        let indexContent = '';
        content.entityForms.forEach(entity => {
            const file = this.options.filePrefix + camelcase(entity.entityName) + this.options.fileSuffix;
            const fileName = file + '.ts';
            const content = this.makeContent(entity);
            indexContent += `export { ${this.getTemplateConstantName(entity)}, ${this.getTemplateInterfaceName(entity)}, ${this.getFactoryName(entity)} } from './${file}';
`;
            fileMap.set(fileName, this.formatContent(content.content));
            content.properties.forEach(p => {
                if (properties.findIndex(o => o.name === p.name) < 0) {
                    properties.push(p);
                }
            });
        });

        let propContent = properties.map(p => `${p.name}?: ${p.type};`).join(`
        `);
        propContent = `export interface ${this.options.templatePropertyInterfaceName}<T = undefined> {
                ${propContent}
                nestedType?: T;
            };`;
        fileMap.set('templateProperty.ts', this.formatContent(propContent));
        indexContent += `export { ${this.options.templatePropertyInterfaceName} } from './templateProperty';
`;

        fileMap.set('index.ts', this.formatContent(indexContent));

        let typesContent = `import { ValidatorFn } from '@angular/forms';
        export type PropertyValidator = ValidatorFn | ValidatorFn[]
`;
        fileMap.set('types.ts', this.formatContent(typesContent));

        for (let file of fileMap.entries()) {
            await this.saveFile(file[1], file[0])
        }
    }

    private formatContent(content: string): string {
        return prettier.format(content, this.options.tslintOptions);
    }

    private static formatTemplateValue(prop: Property): string {
        switch (prop.type) {
            case 'number':
                return `'${prop.name}': ${prop.value}`
            case 'string':
                return `'${prop.name}': '${prop.value}'`
            case 'boolean':
                return `'${prop.name}': ${prop.value}`
            default:
                throw new Error('out of range');
        }
    }

    private getTemplateInterfaceName(entity: EntityForm): string {
        return camelcase(entity.entityName, { pascalCase: true }) + 'Template';
    }

    private getTemplateConstantName(entity: EntityForm): string {
        return camelcase(entity.entityName) + 'Template';
    }

    private getFactoryName(entity: EntityForm, pascalCase = true): string {
        return camelcase(entity.entityName, { pascalCase }) + 'Factory';
    }

    private makeContent(entity: EntityForm): ContentResult {
        const properties: Property[] = [];
        const lineSep = `
                 `;
        let factoryFields: string[] = [];
        let templateFields: string[] = [];
        let templateContractFields: string[] = [];
        let imports = new Map<string, string[]>();

        imports.set('@angular/forms', ['FormGroup', 'FormBuilder'])
        imports.set('./templateProperty', ['TemplateProperty'])
        imports.set('./types', ['PropertyValidator'])

        const formTypes: Set<string> = new Set();
        const factories: Array<{ factoryClassName: string, factoryPropertyName: string }> = [];

        entity.fields.forEach(o => {
            if (o.entity) {
                //Interface
                const interfaceName = this.getTemplateInterfaceName(o.entity);
                formTypes.add(interfaceName);
                templateContractFields.push(`${o.fieldName}: ${this.options.templatePropertyInterfaceName}<${interfaceName}>;`);

                //Template
                const templateConstantName = this.getTemplateConstantName(o.entity);
                formTypes.add(templateConstantName);
                const fieldType = o.definition?.properties?.[o.fieldName]?.type;
                if (typeof fieldType === "string" && fieldType === "object") {
                    templateFields.push(`'${o.fieldName}': ${templateConstantName}`);
                } else {
                    templateFields.push(`'${o.fieldName}': {
                        ${o.properties.map(s => DefaultOutputFormatter.formatTemplateValue(s)).join(',' + lineSep)}
                        'nestedType': ${templateConstantName}
                    }`);
                }

                //Factory
                factories.push({ factoryClassName: this.getFactoryName(o.entity), factoryPropertyName: this.getFactoryName(o.entity, false) });
                formTypes.add(this.getFactoryName(o.entity));
                factoryFields.push(`'${o.fieldName}': (fg: FormGroup) => this.${this.getFactoryName(o.entity, false)}.fillForm(fg)`);
            } else {
                //Interface
                templateContractFields.push(`${o.fieldName}: ${this.options.templatePropertyInterfaceName};`);

                //Template
                templateFields.push(`'${o.fieldName}': {
                    ${o.properties.map(s => DefaultOutputFormatter.formatTemplateValue(s)).join(',' + lineSep)}
                }`);

                //Factory
                factoryFields.push(`'${o.fieldName}': [${o.validators.map(o => o.definition).join(', ')}]`);
            }

            o.properties.forEach(p => {
                properties.push(p);
            });

            o.validators.forEach(prop => {
                if (!imports.has(prop.import.path)) {
                    imports.set(prop.import.path, []);
                }
                const cRef = imports.get(prop.import.path);
                if (cRef != null) {
                    if (cRef.indexOf(prop.import.name) < 0) {
                        cRef.push(prop.import.name);
                    }
                }
            })
        });
        let importsValues: string[] = [];
        imports.set("./", Array.from(formTypes));
        imports.forEach((value, key) => {
            importsValues.push(`import {${value.join(', ')}} from '${key}';`);
        });

        const content = `${importsValues.join(lineSep)}
        
        export interface ${this.getTemplateInterfaceName(entity)} {
            ${templateContractFields.join(lineSep)}
        }
        
        export const ${this.getTemplateConstantName(entity)}: ${this.getTemplateInterfaceName(entity)} = {
            ${templateFields.join(',' + lineSep)}
        }
        
        export class ${this.getFactoryName(entity)} {
            ${factories.map(f => `${f.factoryPropertyName}: ${f.factoryClassName};`).join(lineSep)}

            private readonly _fields: { [id: string] : PropertyValidator | ((fb: FormGroup) => FormGroup); } = {
                ${factoryFields.join(`,
                 `)}
            };
            
            constructor(private readonly _formBuilder: FormBuilder) {
                ${factories.map(f => `this.${f.factoryPropertyName} = new ${f.factoryClassName}(_formBuilder);`).join(lineSep)}
            }
            
            public fillForm(form: FormGroup): FormGroup {
                Object.keys(this._fields).forEach(fieldKey => {
                    form.addControl(
                        fieldKey,
                        typeof this._fields[fieldKey] === "function"
                            ? (this._fields[fieldKey] as Function)(this._formBuilder.group({}))
                            : this._formBuilder.control(null, this._fields[fieldKey] as [])
                    );
                });
                return form;
            }
        }
        `;
        return {
            content: content,
            properties: properties
        }
    }

    private async saveFile(file: string, fileName: string): Promise<void> {
        const project = new Project();
        project.createSourceFile(this.options.outputFolder + fileName, file, { overwrite: true });
        return project.save();
    }
}

type ContentResult = {
    content: string;
    properties: Property[]
}
