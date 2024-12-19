// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as xml2js from 'xml2js';
import * as xpath from 'xml2js-xpath';


// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
var debug = false;
var exceedinglyVerbose: boolean = false;
var rootpath: string;
var scriptPropertiesPath: string;


function findRelevantPortion(text: string){
	let pos = Math.max(text.lastIndexOf("."), text.lastIndexOf('"',text.length-2));
	if (pos === -1){
		return null;
	}
	let newToken = text.substring(pos + 1);
	if (newToken.endsWith("\"")){
		newToken = newToken.substring(0, newToken.length - 1);
	}
	let prevPos = Math.max(text.lastIndexOf(".", pos-1),text.lastIndexOf('"', pos-1));
	// TODO something better
	if (text.length - pos > 3 && prevPos === -1){
		return ["", newToken];
	}
	let prevToken = text.substring(prevPos + 1, pos);
	return [prevToken, newToken];
}

class TypeEntry {
	properties:Map<string, string> = new Map<string, string>();
	supertype?:string;
	literals: Set<string>= new Set<string>();
	addProperty(value:string, type:string=""){
		this.properties.set(value, type);
	}
	addLiteral(value: string){
		this.literals.add(value);
	}
}

class CompletionDict implements vscode.CompletionItemProvider {
	typeDict: Map<string, TypeEntry> = new Map<string, TypeEntry>();
	addType(key: string, supertype?: string): void {
		let k = cleanStr(key);
		var entry = this.typeDict.get(k);
		if (entry === undefined) {
			entry = new TypeEntry();
			this.typeDict.set(k, entry);
		}
		if (supertype !== "datatype") {
			entry.supertype = supertype;
		}
	}

	addTypeLiteral(key: string, val: string): void {
		let k = cleanStr(key);
		let v = cleanStr(val);
		var entry = this.typeDict.get(k);
		if (entry === undefined) {
			entry = new TypeEntry();
			this.typeDict.set(k, entry);
		}
		entry.addLiteral(v);
	}

	addProperty(key: string, prop: string, type?: string): void {
		let k = cleanStr(key);
		var entry = this.typeDict.get(k);
		if (entry === undefined) {
			entry = new TypeEntry();
			this.typeDict.set(k, entry);
		}
		entry.addProperty(prop, type);
	}


	addItem(items: Map<string, vscode.CompletionItem>, complete: string, info?: string): void {
		// TODO handle better
		if (["", "boolean", "int", "string", "list", "datatype"].indexOf(complete) > -1) {
			return;
		}

		if (items.has(complete)) {
			if (exceedinglyVerbose) {
				console.log("\t\tSkipped existing completion: ", complete);
			}
			return;
		}

		
		let result = new vscode.CompletionItem(complete);
		if (info !== undefined) {
			result.detail = info;
		} else {
			result.detail = complete;
		}
		if (exceedinglyVerbose) {
			console.log("\t\tAdded completion: " + complete + " info: " + result.detail);
		}
		items.set(complete, result);
	}
	buildProperty(prefix: string, typeName: string, propertyName: string, propertyType: string, items: Map<string, vscode.CompletionItem>, depth: number) {
		// TODO handle better
		if (["", "boolean", "int", "string", "list", "datatype"].indexOf(propertyName) > -1) {
			return;
		}
		// TODO handle better
		if (["", "boolean", "int", "string", "list", "datatype"].indexOf(typeName) > -1) {
			return;
		}
		if (exceedinglyVerbose) {
			console.log("\tBuilding Property", typeName + "." + propertyName, "depth: ", depth, "prefix: ", prefix);
		}
		let completion: string;
		if (prefix !== "") {
			completion = prefix + "." + cleanStr(propertyName);
		} else {
			completion = propertyName;
		}
		// TODO bracket handling
		// let specialPropMatches =propertyName.match(/(?:[^{]*){[$].*}/g);
		// if (specialPropMatches !== null){
		// 	specialPropMatches.forEach(element => {
		// 		let start = element.indexOf("$")+1;
		// 		let end = element.indexOf("}", start);
		// 		let specialPropertyType = element.substring(start, end);
		// 		let newStr =  completion.replace(element, "{"+specialPropertyType+".}")
		// 		this.addItem(items, newStr);
		// 		return;
		// 	});
		// } else {
		this.addItem(items, completion, typeName + "." + propertyName);
		this.buildType(completion, propertyType, items, depth + 1);
		// }
	}

	buildType(prefix: string, typeName: string, items: Map<string, vscode.CompletionItem>, depth: number): void {
		// TODO handle better
		if (["", "boolean", "int", "string", "list", "datatype"].indexOf(typeName) > -1) {
			return;
		}
		if (exceedinglyVerbose) {
			console.log("Building Type: ", typeName, "depth: ", depth, "prefix: ", prefix);
		}
		let entry = this.typeDict.get(typeName);
		if (entry === undefined) {
			return;
		}
		if (depth > 1) {
			if (exceedinglyVerbose) {
				console.log("\t\tMax depth reached, returning");
			}
			return;
		}

		if (depth > -1 && prefix !== "") {
			this.addItem(items, typeName);
		}

		if (items.size > 1000) {
			if (exceedinglyVerbose) {
				console.log("\t\tMax count reached, returning");
			}
			return;
		}
	
		for (const prop of entry.properties.entries()) {
			this.buildProperty(prefix, typeName, prop[0], prop[1], items, depth + 1);
		}
		if (entry.supertype !== undefined) {
			if (exceedinglyVerbose) {
				console.log("Recursing on supertype: ", entry.supertype);
			}
			this.buildType(typeName, entry.supertype, items, depth + 1);
		}
	}
	makeCompletionList(items: Map<string, vscode.CompletionItem>):
		vscode.CompletionList {
		return new vscode.CompletionList(Array.from(items.values()), true);
	}

	provideCompletionItems(document: vscode.TextDocument, position: vscode.Position) {
		let items = new Map<string,vscode.CompletionItem>();
		let prefix= document.lineAt(position).text.substring(0, position.character);
		let interesting = findRelevantPortion(prefix);
		if (interesting === null){	
			if (exceedinglyVerbose){
				console.log("no relevant portion detected");
			}
			return this.makeCompletionList(items);
		}
		let prevToken = interesting[0];
		let newToken = interesting[1];
		if (exceedinglyVerbose){
			console.log("Previous token: ",interesting[0], " New token: ",interesting[1]);
		}
		// If we have a previous token & it's in the typeDictionary, only use that's entries
		if (prevToken !== ""){

			let entry = this.typeDict.get(prevToken);
			if (entry===undefined) {
				if (exceedinglyVerbose){
					console.log("Missing previous token!");
				}
				// TODO backtrack & search
				return;
			} else {
				if (exceedinglyVerbose){
					console.log("Matching on type!");
				}
				
				entry.properties.forEach((v, k)=> {
					if (exceedinglyVerbose){
						console.log("Top level property: ", k, v);
					}
					this.buildProperty("",prevToken,k, v, items, 0);
				});
				return this.makeCompletionList(items);
			}
		}
		// Ignore tokens where all we have is a short string and no previous data to go off of
		if (prevToken === "" && newToken.length < 2){
			if (exceedinglyVerbose){
				console.log("Ignoring short token without context!");
			}
			return this.makeCompletionList(items);
		}
		// Now check for the special hard to complete onles
		if (prevToken.startsWith("{")){
			if (exceedinglyVerbose){
				console.log("Matching bracketed type");
			}
			let token = prevToken.substring(1);

			let entry = this.typeDict.get(token);
			if (entry === undefined){
				if (exceedinglyVerbose){
					console.log("Failed to match bracketed type");
				}
			} else {
				entry.literals.forEach(value =>{
					this.addItem(items,value+"}");
				});
			}
		}


		if (exceedinglyVerbose){
			console.log("Trying fallback");
		}
		// Otherwise fall back to looking at keys of the typeDictionary for the new string
		for (const key of this.typeDict.keys()) {
			if (!key.startsWith(newToken)) {
				continue;
			}
			this.buildType("", key, items, 0);
		}
		return this.makeCompletionList(items);
	}
}


class LocationDict implements vscode.DefinitionProvider
{
	dict: Map<string, vscode.Location> = new Map<string, vscode.Location>();

	addLocation(name: string, file: string, start: vscode.Position, end: vscode.Position): void{
		let range = new vscode.Range(start, end);
		let uri = vscode.Uri.parse("file://"+file);
		this.dict.set(cleanStr(name), new vscode.Location(uri, range));
	}
	addLocationForRegexMatch(rawData: string, rawIdx:number, name: string){
		// make sure we don't care about platform & still count right https://stackoverflow.com/a/8488787
		let line = rawData.substring(0, rawIdx).split(/\r\n|\r|\n/).length-1;
		let startIdx = Math.max(rawData.lastIndexOf("\n", rawIdx),rawData.lastIndexOf("\r", rawIdx));
		let start = new vscode.Position(line, rawIdx - startIdx);
		let endIdx = rawData.indexOf(">", rawIdx)+2;
		let end = new vscode.Position(line, endIdx - rawIdx);
		this.addLocation(name, scriptPropertiesPath, start, end);
	}

	addNonPropertyLocation(rawData: string,name: string, tagType: string): void{
		let rawIdx = rawData.search("<"+tagType+" name=\""+ escapeRegex(name)+"\"[^>]*>");
		this.addLocationForRegexMatch(rawData, rawIdx, name);
	}

	addPropertyLocation(rawData: string, name:string, parent: string, parentType: string) : void{
		let re = new RegExp("(?:<"+parentType+" name=\""+ escapeRegex(parent)+"\"[^>]*>.*?)(<property name=\""+escapeRegex(name) +"\"[^>]*>)","s");
		let matches = rawData.match(re);
		if (matches === null || matches.index === undefined){
			console.log("strangely couldn't find property named:",name,"parent:",parent);
			return;
		}
		let rawIdx = matches.index + matches[0].indexOf(matches[1]);
		this.addLocationForRegexMatch(rawData, rawIdx, parent+"."+name);
	}

	provideDefinition(document: vscode.TextDocument, position: vscode.Position){
		let line = document.lineAt(position).text;
		let start = line.lastIndexOf("\"", position.character);
		let end = line.indexOf("\"",position.character);
		let relevant = line.substring(start, end).trim().replace("\"","");
		do{
			if (this.dict.has(relevant)){
				return this.dict.get(relevant);
			}
			relevant = relevant.substring(relevant.indexOf(".")+1);
		} while (relevant.indexOf(".") !== -1);
		return undefined;
	}
}

let completionProvider = new CompletionDict();
let definitionProvider = new LocationDict();

function readScriptProperties(filepath: string) {
  console.log("Attempting to read scriptproperties.xml");
  // Can't move on until we do this so use sync version
  let rawData = fs.readFileSync(filepath).toString();
  let keywords = [] as Keyword[];
  let datatypes = [] as Datatype[];

  xml2js.parseString(rawData, function (err: any, result: any) {
    if (err !== null) {
      vscode.window.showErrorMessage("Error during parsing of scriptproperties.xml:" + err);
    }

    // Process keywords and datatypes here, return the completed results
    keywords = processKeywords(rawData, result["scriptproperties"]["keyword"]);
    datatypes = processDatatypes(rawData, result["scriptproperties"]["datatype"]);

    completionProvider.addTypeLiteral("boolean", "==true");
    completionProvider.addTypeLiteral("boolean", "==false");
    console.log("Parsed scriptproperties.xml");
  });

  return { keywords, datatypes };
}


function cleanStr(text: string){
	return text.replace(/</g,"\&lt;").replace(/>/g,"\&gt;");
}
function escapeRegex(text: string){
	// https://stackoverflow.com/a/6969486
	return cleanStr(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
}

function processProperty(rawData: string, parent: string, parentType:string, prop:ScriptProperty){
	let name = prop.$.name;
	if (exceedinglyVerbose){
		console.log("\tProperty read: ", name);
	}
	definitionProvider.addPropertyLocation(rawData, name, parent, parentType);
	completionProvider.addProperty(parent, name, prop.$.type);
}


function processKeyword(rawData: string, e: Keyword){
	let name = e.$.name;
	definitionProvider.addNonPropertyLocation(rawData,name, "keyword");
	if (exceedinglyVerbose){
		console.log("Keyword read: " + name);
	}

	if (e.import !== undefined) {
		let imp = e.import[0];
		let src =imp.$.source;
		let select = imp.$.select;
		let tgtName = imp.property[0].$.name;
		processKeywordImport(name,src, select, tgtName);

	} else if (e.property !== undefined){
		e.property.forEach(prop => processProperty(rawData, name, "keyword", prop));
	}
}

interface XPathResult{
	$:{[key:string]: string};
}
function processKeywordImport(name:string, src: string, select:string, targetName: string){
	let path = rootpath+ "/libraries/"+src;
	console.log("Attempting to import: "+src);
	// Can't move on until we do this so use sync version
	let rawData = fs.readFileSync(path).toString();
	xml2js.parseString(rawData, function (err: any, result:any) {
		if (err !== null){
			vscode.window.showErrorMessage("Error during parsing of " + src+ err);
		}

		var matches = xpath.find(result, select+"/"+targetName);
		matches.forEach((element:XPathResult) => {
			completionProvider.addTypeLiteral(name,element.$[targetName.substring(1)]);
		});
	});
}

interface ScriptProperty {
	$:{
		name: string;
		result: string;
		type?: string;
	};
}
interface Keyword{
	$:{
		name: string;
		type?: string;
		pseudo?: string;
		description?: string;
	};
	property?:[ScriptProperty];
	import?:[{
		$:{
			source: string;
			select: string;
		}
		property:[{
			$:{
				name: string;
			}
		}]
	}];
}

interface Datatype {
	$:{
		name: string;
		type?: string;
		suffix?: string;
	};
	property?:[ScriptProperty];
}

function processDatatype(rawData: any, e: Datatype){
	let name = e.$.name;
	definitionProvider.addNonPropertyLocation(rawData, name, "datatype");
	if (exceedinglyVerbose)	{
		console.log("Datatype read: " + name);
	}
	if (e.property === undefined){
		return;
	}
	completionProvider.addType(name, e.$.type);
	e.property.forEach(prop => processProperty(rawData, name, "datatype", prop));
}


// Process all keywords in the XML
function processKeywords(rawData: string, keywords: any[]): Keyword[] {
  let processedKeywords: Keyword[] = [];
  keywords.forEach((e: Keyword) => {
    processKeyword(rawData, e);
    processedKeywords.push(e);  // Add processed keyword to the array
  });
  return processedKeywords;
}

// Process all datatypes in the XML
function processDatatypes(rawData: string, datatypes: any[]): Datatype[] {
  let processedDatatypes: Datatype[] = [];
  datatypes.forEach((e: Datatype) => {
    processDatatype(rawData, e);
    processedDatatypes.push(e);  // Add processed datatype to the array
  });
  return processedDatatypes;
}


function generateKeywordText(keyword: any, datatypes: Datatype[], parts: string[]): string {
  const description = keyword.$.description;
  const pseudo = keyword.$.pseudo;
  const suffix = keyword.$.suffix;
  const result = keyword.$.result;
	
  let hoverText = `Keyword: ${keyword.$.name}\n
  ${description ? 'Description: ' + description + '\n' : ''}
  ${pseudo ? 'Pseudo: ' + pseudo + '\n' : ''}
  ${result ? 'Result: ' + result + '\n' : ''}
  ${suffix ? 'Suffix: ' + suffix + '\n' : ''}`;
  let name = keyword.$.name;
  let currentPropertyList: ScriptProperty[] = keyword.property;
  let updated = false;

  // Iterate over parts of the path (excluding the first part which is the keyword itself)
  for (let i = 1; i < parts.length; i++) {
    let properties: ScriptProperty[] = [];
    // For the last part, we use 'includes' to match the property
		if (i === parts.length - 1) {
			properties = currentPropertyList.filter((p: ScriptProperty) => {
				// Match the property name with the part (e.g., 'tag' in 'faction.tag')
				const propertyName = p.$.name;

				// Match against templated property names like 'hastag.{$tag}' (accounting for the dynamic part)
				const pattern = new RegExp(`\\{\\$${parts[i]}\\}`, 'i');
				return propertyName.includes(parts[i]) || pattern.test(propertyName);
			});
		} else {
      // For all other parts, check each type and find properties matching the part
      properties = currentPropertyList.filter((p: ScriptProperty) => p.$.name === parts[i]);

      if (properties.length === 0 && currentPropertyList.length > 0) {
        // If no properties match the current part, iterate over each datatype to find a matching type
        currentPropertyList.forEach((property) => {
          if (property.$.type) {
						const type = datatypes.find((d: Datatype) => d.$.name === property.$.type);
            if (type && type.property) {
              // Add the properties from the matching type to the current list
              properties.push(...type.property.filter((p: ScriptProperty) => p.$.name === parts[i]));
            }
          }
        });
      }
    }
    if (properties.length > 0) {
      // Iterate through all the matched properties and add them to hoverText
      properties.forEach((property) => {
        hoverText += `\n\n- ${name}.${property.$.name}: ${property.$.result}`;
        updated = true;

        // Update currentPropertyList for the next part
        if (property.$.type) {
          const type = datatypes.find((d: Datatype) => d.$.name === property.$.type);
          if (type && type.property) {
            currentPropertyList = type.property;
          }
        }
      });

      // Append the current part to 'name' after processing matching properties
      name += `.${parts[i]}`;
    }
	}
	hoverText = hoverText.replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return updated ? hoverText : '';
}


function generateHoverWordText(hoverWord: string, keywords: Keyword[], datatypes: Datatype[]): string {
  let hoverText = '';
  
  // Find keywords that match the hoverWord either in their name or property names
  const matchingKeynames = keywords.filter((k: Keyword) =>
    k.$.name.includes(hoverWord) ||
    k.property?.some((p: ScriptProperty) => p.$.name.includes(hoverWord))
  );
  
  // Find datatypes that match the hoverWord either in their name or property names
  const matchingDatatypes = datatypes.filter((d: Datatype) =>
    d.$.name.includes(hoverWord) || // Check if datatype name includes hoverWord
    d.property?.some((p: ScriptProperty) => p.$.name.includes(hoverWord)) // Check if any property name includes hoverWord
  );
  
  if (debug) {
    console.log("matchingKeynames:", matchingKeynames);
    console.log("matchingDatatypes:", matchingDatatypes);
  }

  let matches = '';

  // Process matching keywords
  if (matchingKeynames.length > 0) {
		matches = matchingKeynames
			.sort()
			.map((k: Keyword) => {
				let header = `\n${k.$.name}`;
				let suggestions = '';
				// Append type, pseudo, and description if available
				if (k.$.description) header += `: ${k.$.description}`;
				if (k.$.type) header += ` (type: ${k.$.type})`;
				if (k.$.pseudo) header += ` (pseudo: ${k.$.pseudo})`;
				header += '\n';
				
				// Find the properties matching the hover part of the path
				const properties = k.property?.filter((p: ScriptProperty) => p.$.name.includes(hoverWord));
				if (properties && properties.length > 0) {
					// Append matching properties
					suggestions += properties
						.sort()
						.map((possibleProperty) => {
							if (possibleProperty && possibleProperty.$.result.length > 0) {
								return `- ${k.$.name}.${possibleProperty.$.name}: ${possibleProperty.$.result}`;
							}
							return null;
						})
						//.filter((suggestion) => suggestion !== null) // Remove null results
						.join('\n'); // Join the properties into a single string
				}
				return suggestions != '' ? header += suggestions : '';
      })
      .filter((match) => match !== '') // Remove empty suggestions
      .join('\n'); // Join all suggestions into a single string
  }

  // Process matching datatypes
  if (matchingDatatypes.length > 0) {
    if (matches !== '') {
      matches += '\n'; // Add a line break between keyword and datatype suggestions
    }
    matches += matchingDatatypes
      .sort()
			.map((d: Datatype) => {
				
        let header = `\n${d.$.name}`;
				let suggestions = '';
        
        // Append type and suffix if available
        if (d.$.type) header += ` (type: ${d.$.type})`;
        if (d.$.suffix) header += ` (suffix: ${d.$.suffix})`;
				header += '\n';

        // Find the properties matching the hover part of the path
        const properties = d.property?.filter((p: ScriptProperty) => p.$.name.includes(hoverWord));
        if (properties && properties.length > 0) {
          // Append matching properties
					suggestions += properties
						.sort()
            .map((possibleProperty) => {
              if (possibleProperty && possibleProperty.$.result.length > 0) {
                return `- ${d.$.name}.${possibleProperty.$.name}: ${possibleProperty.$.result}`;
              }
              return null;
            })
            //.filter((suggestion) => suggestion !== null) // Remove null results
            .join('\n'); // Join the properties into a single string
        }

				return suggestions != '' ? header += suggestions : '';
      })
      .filter((match) => match !== '') // Remove empty suggestions
      .join('\n'); // Join all suggestions into a single string
  }

  // If suggestions exist, sort them and display them
	if (matches !== '') {
    matches = matches.replace(/</g, '&lt;').replace(/>/g, '&gt;')
    hoverText += `\n\nMatches for '${hoverWord}':\n${matches}`;
  }

  return hoverText; // Return the constructed hoverText
}


export function activate(context: vscode.ExtensionContext) {

  let config = vscode.workspace.getConfiguration("x4CodeComplete");
  if (config === undefined) {
    vscode.window.showErrorMessage("Could not read config!");
    return;
  }

  rootpath = config["unpackedFileLocation"];
  if (rootpath === "") {
    vscode.window.showErrorMessage("You must configure the path to unpacked files! Do so & restart VS Code!");
    return;
  }

  exceedinglyVerbose = config["exceedinglyVerbose"];
	scriptPropertiesPath = rootpath + "/libraries/scriptproperties.xml";
	let keywords = [] as Keyword[];
	let datatypes = [] as Keyword[];
	({ keywords, datatypes } = readScriptProperties(scriptPropertiesPath));

  let sel: vscode.DocumentSelector = { language: 'xml' };

  let disposableCompleteProvider = vscode.languages.registerCompletionItemProvider(sel, completionProvider, ".", "\"", "{");
  context.subscriptions.push(disposableCompleteProvider);

  let disposableDefinitionProvider = vscode.languages.registerDefinitionProvider(sel, definitionProvider);
  context.subscriptions.push(disposableDefinitionProvider);

  // Hover provider to display tooltips
	context.subscriptions.push(
		vscode.languages.registerHoverProvider(sel, {
			provideHover: async (document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Hover | undefined> => {
				const hoverWord = document.getText(document.getWordRangeAtPosition(position));
				const phraseRegex = /([.]*[$@]*[a-zA-Z0-9_-{}])+/g;
				const phrase = document.getText(document.getWordRangeAtPosition(position, phraseRegex));
				const hoverWordIndex = phrase.lastIndexOf(hoverWord);
				const slicedPhrase = phrase.slice(0, hoverWordIndex + hoverWord.length);
				const parts = slicedPhrase.split('.');
				// Extract the first part of the word and remove any leading `$ or @`
				const firstPart = parts[0].startsWith('$') || parts[0].startsWith('@') ? parts[0].slice(1) : parts[0];
				if (debug) {
					console.log("Hover word: ", hoverWord);
					console.log("Phrase: ", phrase);
					console.log("Sliced phrase: ", slicedPhrase);
					console.log("Parts: ", parts);
					console.log("First part: ", firstPart);
				}

				// Find matching keyword
				let hoverText = '';
				let keyword = keywords.find((k: Keyword) => k.$.name === firstPart);
				if (!keyword || keyword.import) {
					keyword = datatypes.find((d: Datatype) => d.$.name === firstPart);
				}

				// Generate hover text
				if (keyword && firstPart !== hoverWord) {
					hoverText = generateKeywordText(keyword, datatypes, parts);
				}
				if (!hoverText.includes(keyword+':') || firstPart === hoverWord) {
					hoverText += generateHoverWordText(hoverWord,	keywords, datatypes);
				}
				return hoverText !== '' ? new vscode.Hover(hoverText) : undefined;
			},
		})
	);
}

// this method is called when your extension is deactivated
export function deactivate() {}