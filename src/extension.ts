// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as xml2js from 'xml2js';
import * as path from 'path';


// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
var exceedinglyVerbose: boolean = false;
var limitLanguage: boolean = false;
var rootpath: string;
var extensionsFolder: string;
let languageFiles: Map<string, any> = new Map();

// Add settings validation function
function validateSettings(config: vscode.WorkspaceConfiguration): boolean {
    const requiredSettings = [
        'unpackedFileLocation',
        'extensionsFolder'
    ];
    
    let isValid = true;
		requiredSettings.forEach(setting => {
			if (!config.get(setting)) {
				vscode.window.showErrorMessage(
					`Missing required setting: ${setting}. Please update your VSCode settings.`
				);
				isValid = false;
			}
    });
    
    return isValid;
}

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

// load and parse language files
function loadLanguageFiles(basePath: string, extensionsFolder: string) {
	console.log("Loading Language Files");
	try {
		// Array to store all valid 't' directory paths
		const tDirectories: string[] = [];

		// Check root 't' directory under unpackedFileLocation
		const rootTPath = path.join(basePath, 't');
		if (fs.existsSync(rootTPath) && fs.statSync(rootTPath).isDirectory()) {
			tDirectories.push(rootTPath);
		}
		// Check 't' directories under languageFilesFolder subdirectories
		if (fs.existsSync(extensionsFolder) && fs.statSync(extensionsFolder).isDirectory()) {
			const subdirectories = fs.readdirSync(extensionsFolder, { withFileTypes: true })
				.filter(item => item.isDirectory())
				.map(item => item.name);

			for (const subdir of subdirectories) {
				const tPath = path.join(extensionsFolder, subdir, 't');
				if (fs.existsSync(tPath) && fs.statSync(tPath).isDirectory()) {
					tDirectories.push(tPath);
				}
			}
		}

		// Process all found 't' directories
		for (const tDir of tDirectories) {
			const files = fs.readdirSync(tDir);
			const languageFilesFiltered = files.filter(file => 
				file.startsWith('0001') && file.endsWith('.xml')
			);
			
			for (const file of languageFilesFiltered) {
				const filePath = path.join(tDir, file);
				try {
					const rawData = fs.readFileSync(filePath, 'utf-8');
					xml2js.parseString(rawData, (err: any, result: any) => {
						if (err) {
							console.error(`Error parsing ${file} in ${tDir}: ${err}`);
							return;
						}
						languageFiles.set(filePath, result);				
					});
				} catch (fileError) {
					console.error(`Error reading ${file} in ${tDir}: ${fileError}`);
				}
			}
		}

		console.log(`Loaded ${languageFiles.size} language files from ${tDirectories.length} 't' directories`);
	} catch (error) {
		console.error(`Error loading language files: ${error}`);
		vscode.window.showErrorMessage('Failed to load language files from t directories');
	}
}

function findLanguageText(pageId: string, textId: string): string {
	const config = vscode.workspace.getConfiguration("x4CodeComplete-lua");
	const preferredLanguageNumber = config.get("languageNumber") || "44";
	limitLanguage = config.get("limitLanguageOutput") || false;

	interface Match {
		fileNumber: string;
		text: string;
	}
	let allMatches: Match[] = [];

	for (const [filePath, xmlData] of languageFiles) {
		if (!xmlData?.language?.page) continue;

		const page = xmlData.language.page.find((p: any) => 
			p?.$?.id === pageId
		);

		if (page?.t) {
			const text = page.t.find((t: any) => 
				t?.$?.id === textId
			);
			if (text?._) {
				const fileName = path.basename(filePath);
				let fileNumber: string;

				if (fileName === '0001.xml') {
					fileNumber = '44'; // Special case for 0001.xml
				} else {
					// Try matching 0001-<letter><number>.xml (e.g., 0001-l007.xml)
					const matchWithLetter = fileName.match(/0001-[a-zA-Z](\d+)\.xml$/);
					if (matchWithLetter && matchWithLetter[1]) {
						fileNumber = matchWithLetter[1].replace(/^0+/, '');
					} else {
						// Original match for 0001-<number>.xml
						const match = fileName.match(/0001-(\d+)\.xml$/);
						if (match && match[1]) {
							fileNumber = match[1].replace(/^0+/, '');
						} else {
							// Fallback for any number after 0001- or 0001
							const fallbackMatch = fileName.match(/0001-?[a-zA-Z]?(\d+)/);
							fileNumber = fallbackMatch && fallbackMatch[1] 
								? fallbackMatch[1].replace(/^0+/, '')
								: 'Unknown';
						}
					}
				}

				console.log(`Extracted fileNumber: ${fileNumber} from ${fileName}`);

				if (limitLanguage){
		                    if (fileNumber == preferredLanguageNumber){
					allMatches.push({
						fileNumber,
						text: text._.split('\n').map((line: string) => `${fileNumber}: ${line}`).join('\n')
					});
		                    }
		                }
		                else {
					allMatches.push({
						fileNumber,
						text: text._.split('\n').map((line: string) => `${fileNumber}: ${line}`).join('\n')
					});            
		                }
			}
		}
	}

	allMatches.sort((a, b) => {
		if (a.fileNumber === preferredLanguageNumber && b.fileNumber !== preferredLanguageNumber) return -1;
		if (b.fileNumber === preferredLanguageNumber && a.fileNumber !== preferredLanguageNumber) return 1;
		return a.fileNumber.localeCompare(b.fileNumber);
	});

	return allMatches.length > 0 
		? allMatches.map(match => match.text).join('\n\n')
		: '';
}


export function activate(context: vscode.ExtensionContext) {

	let config = vscode.workspace.getConfiguration("x4CodeComplete-lua");
	if (!config || !validateSettings(config)) {
			return;
	}

	rootpath = config.get("unpackedFileLocation") || "";
	extensionsFolder = config.get("extensionsFolder") || "";
	exceedinglyVerbose = config.get("exceedinglyVerbose") || false;

	// Load language files
	loadLanguageFiles(rootpath, extensionsFolder);
	
  let sel: vscode.DocumentSelector = { language: 'lua' };

  // Hover provider to display tooltips
	context.subscriptions.push(
		vscode.languages.registerHoverProvider(sel, {
			provideHover: async (document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Hover | undefined> => {
				const tPattern = /ReadText\s*\(\s*(\d+),\s*(\d+)\s*\)/g;
				// matches:
				// ReadText(1015, 7)

				const range = document.getWordRangeAtPosition(position, tPattern);
				if (range) {
					const text = document.getText(range);
					const matches = tPattern.exec(text);
					tPattern.lastIndex = 0; // Reset regex state


					console.log(`text: ${text}`);
					console.log(`matches: ${matches}`)
					if (matches && matches.length >= 3) {
						let pageId: string | undefined;
						let textId: string | undefined;
						if (matches[1] && matches[2]) { // {1015,7} or {1015, 7}
								pageId = matches[1];
								textId = matches[2];
						} else if (matches[3] && matches[4]) { // readtext.{1015}.{7}
								pageId = matches[3];
								textId = matches[4];
						} else if (matches[5] && matches[6]) { // page="1015" line="7"
								pageId = matches[5];
								textId = matches[6];
						}

						if (pageId && textId) {
								if (exceedinglyVerbose) {
										console.log(`Matched pattern: ${text}, pageId: ${pageId}, textId: ${textId}`);
								}
								const languageText = findLanguageText(pageId, textId);
								if (languageText) {
										const hoverText = new vscode.MarkdownString();
										hoverText.appendMarkdown('```plaintext\n');
										hoverText.appendMarkdown(languageText);
										hoverText.appendMarkdown('\n```');
										return new vscode.Hover(hoverText, range);
								}
						}
						return undefined;
					}
				}
			},
		})
	);
}

// this method is called when your extension is deactivated
export function deactivate() {}
