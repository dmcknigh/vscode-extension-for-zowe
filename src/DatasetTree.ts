/*
* This program and the accompanying materials are made available under the terms of the *
* Eclipse Public License v2.0 which accompanies this distribution, and is available at *
* https://www.eclipse.org/legal/epl-v20.html                                      *
*                                                                                 *
* SPDX-License-Identifier: EPL-2.0                                                *
*                                                                                 *
* Copyright Contributors to the Zowe Project.                                     *
*                                                                                 *
*/

import * as zowe from "@zowe/cli";
import { IProfileLoaded, Logger } from "@zowe/imperative";
import * as path from "path";
import * as vscode from "vscode";
import * as nls from "vscode-nls";
import * as extension from "../src/extension";
import { Profiles } from "./Profiles";
import { ZoweExplorerApiRegister } from "./api/ZoweExplorerApiRegister";
import { sortTreeItems, applyIcons, FilterDescriptor, FilterItem, getAppName, resolveQuickPickHelper, errorHandling } from "./utils";
import { IZoweTree } from "./api/IZoweTree";
import { IZoweDatasetTreeNode } from "./api/IZoweTreeNode";
import { ZoweTreeProvider } from "./abstract/ZoweTreeProvider";
import { ZoweDatasetNode } from "./ZoweDatasetNode";
const localize = nls.config({ messageFormat: nls.MessageFormat.file })();

/**
 * Creates the Dataset tree that contains nodes of sessions and data sets
 *
 * @export
 */
export async function createDatasetTree(log: Logger) {
    const tree = new DatasetTree();
    await tree.initialize(log);
    await tree.addSession();
    return tree;
}

/**
 * A tree that contains nodes of sessions and data sets
 *
 * @export
 * @class DatasetTree
 * @implements {vscode.TreeDataProvider}
 */
export class DatasetTree extends ZoweTreeProvider implements IZoweTree<IZoweDatasetTreeNode> {

    private static readonly persistenceSchema: string = "Zowe-DS-Persistent";
    private static readonly defaultDialogText: string = "\uFF0B " + localize("defaultFilterPrompt.option.prompt.search",
        "Create a new filter. Comma separate multiple entries (pattern 1, pattern 2, ...)");
    public mFavoriteSession: ZoweDatasetNode;

    public mSessionNodes: IZoweDatasetTreeNode[] = [];
    public mFavorites: IZoweDatasetTreeNode[] = [];
    private treeView: vscode.TreeView<IZoweDatasetTreeNode>;

    constructor() {
        super(DatasetTree.persistenceSchema, new ZoweDatasetNode(localize("Favorites", "Favorites"),
                                                    vscode.TreeItemCollapsibleState.Collapsed, null, null, null));
        this.mFavoriteSession.contextValue = extension.FAVORITE_CONTEXT;
        this.mFavoriteSession.iconPath = applyIcons(this.mFavoriteSession);
        this.mSessionNodes = [this.mFavoriteSession];
        this.treeView = vscode.window.createTreeView("zowe.explorer", {treeDataProvider: this});
    }

    /**
     * Takes argument of type IZoweDatasetTreeNode and retrieves all of the first level children
     *
     * @param {IZoweDatasetTreeNode} [element] - Optional parameter; if not passed, returns root session nodes
     * @returns {IZoweDatasetTreeNode[] | Promise<IZoweDatasetTreeNode[]>}
     */
    public async getChildren(element?: IZoweDatasetTreeNode | undefined): Promise<IZoweDatasetTreeNode[]> {
        if (element) {
            if (element.contextValue === extension.FAVORITE_CONTEXT) {
                return this.mFavorites;
            }
            return element.getChildren();
        }
        return this.mSessionNodes;
    }

    /**
     * Initializes the tree based on favorites held in persistent store
     *
     * @param {Logger} log
     */
    public async initialize(log: Logger) {
        this.log = log;
        this.log.debug(localize("initializeFavorites.log.debug", "initializing favorites"));
        const lines: string[] = this.mHistory.readFavorites();
        for (const line of lines) {
            if (line === "") {
                continue;
            }
            // validate line
            const favoriteDataSetPattern = /^\[.+\]\:\s[a-zA-Z#@\$][a-zA-Z0-9#@\$\-]{0,7}(\.[a-zA-Z#@\$][a-zA-Z0-9#@\$\-]{0,7})*\{p?ds\}$/;
            const favoriteSearchPattern = /^\[.+\]\:\s.*\{session\}$/;
            if (favoriteDataSetPattern.test(line)) {
                const sesName = line.substring(1, line.lastIndexOf("]")).trim();
                try {
                    const profile = Profiles.getInstance().loadNamedProfile(sesName);
                    const session = ZoweExplorerApiRegister.getMvsApi(profile).getSession();
                    let node: ZoweDatasetNode;
                    if (line.substring(line.indexOf("{") + 1, line.lastIndexOf("}")) === extension.DS_PDS_CONTEXT) {
                        node = new ZoweDatasetNode(line.substring(0, line.indexOf("{")), vscode.TreeItemCollapsibleState.Collapsed,
                            this.mFavoriteSession, session, undefined, undefined, profile);
                    } else {
                        node = new ZoweDatasetNode(line.substring(0, line.indexOf("{")), vscode.TreeItemCollapsibleState.None,
                            this.mFavoriteSession, session, undefined, undefined, profile);
                        node.command = { command: "zowe.ZoweNode.openPS", title: "", arguments: [node] };
                    }
                    node.contextValue += extension.FAV_SUFFIX;
                    node.iconPath = applyIcons(node);
                    this.mFavorites.push(node);
                } catch(e) {
                    const errMessage: string =
                    localize("initializeFavorites.error.profile1",
                    "Error: You have Zowe Data Set favorites that refer to a non-existent CLI profile named: ") + sesName +
                    localize("intializeFavorites.error.profile2",
                    ". To resolve this, you can create a profile with this name, ") +
                    localize("initializeFavorites.error.profile3",
                    "or remove the favorites with this profile name from the Zowe-DS-Persistent setting, which can be found in your ") +
                    getAppName(extension.ISTHEIA) + localize("initializeFavorites.error.profile4", " user settings.");
                    await errorHandling(e, null, errMessage);
                    continue;
                }
            } else if (favoriteSearchPattern.test(line)) {
                const sesName = line.substring(1, line.lastIndexOf("]")).trim();
                let profile: IProfileLoaded;
                try {
                    profile = Profiles.getInstance().loadNamedProfile(sesName);
                } catch (error) {
                    const errMessage: string =
                    localize("loadNamedProfile.error.profileName",
                    "Initialization Error: Could not find profile named: ") +
                    + sesName +
                    localize("loadNamedProfile.error.period", ".");
                    await errorHandling(error, null, errMessage);
                    continue;
                }
                const session = ZoweExplorerApiRegister.getMvsApi(profile).getSession();
                const node = new ZoweDatasetNode(line.substring(0, line.lastIndexOf("{")),
                    vscode.TreeItemCollapsibleState.None, this.mFavoriteSession, session, undefined, undefined, profile);
                node.command = { command: "zowe.pattern", title: "", arguments: [node] };
                const light = path.join(__dirname, "..", "..", "resources", "light", "pattern.svg");
                const dark = path.join(__dirname, "..", "..", "resources", "dark", "pattern.svg");
                node.iconPath = { light, dark };
                node.contextValue = extension.DS_SESSION_CONTEXT + extension.FAV_SUFFIX;
                node.iconPath = applyIcons(node);
                this.mFavorites.push(node);
            } else {
                vscode.window.showErrorMessage(localize("initializeFavorites.fileCorrupted", "Favorites file corrupted: ") + line);
            }
        }
    }

    /**
     * Returns the tree view for the current DatasetTree
     *
     * @returns {vscode.TreeView<IZoweDatasetTreeNode>}
     */
    public getTreeView(): vscode.TreeView<IZoweDatasetTreeNode> {
        return this.treeView;
    }

    /**
     * Adds a new session to the data set tree
     *
     * @param {string} [sessionName] - optional; loads default profile if not passed
     */
    public async addSession(sessionName?: string) {
        // Loads profile associated with passed sessionName, default if none passed
        if (sessionName) {
            const zosmfProfile: IProfileLoaded = Profiles.getInstance().loadNamedProfile(sessionName);
            if (zosmfProfile) {
                this.addSingleSession(zosmfProfile);
            }
        } else {
            const profiles: IProfileLoaded[] = Profiles.getInstance().allProfiles;
            for (const zosmfProfile of profiles) {
                // If session is already added, do nothing
                if (this.mSessionNodes.find((tempNode) => tempNode.label.trim() === zosmfProfile.name)) {
                    continue;
                }
                for (const session of this.mHistory.getSessions()) {
                    if (session === zosmfProfile.name) {
                        this.addSingleSession(zosmfProfile);
                    }
                }
            }
            if (this.mSessionNodes.length === 1) {
                this.addSingleSession(Profiles.getInstance().getDefaultProfile());
            }
        }
        this.refresh();
    }

    /**
     * Removes a session from the list in the data set tree
     *
     * @param {IZoweDatasetTreeNode} [node]
     */
    public deleteSession(node: IZoweDatasetTreeNode) {
        this.mSessionNodes = this.mSessionNodes.filter((tempNode) => tempNode.label.trim() !== node.label.trim());
        let revisedLabel =  node.label;
        if (revisedLabel.includes("[")) {
            revisedLabel = revisedLabel.substring(0, revisedLabel.indexOf(" ["));
        }
        this.mHistory.removeSession(revisedLabel);
        this.refresh();
    }

    /**
     * Adds a node to the favorites list
     *
     * @param {IZoweDatasetTreeNode} node
     */
    public async addFavorite(node: IZoweDatasetTreeNode) {
        let temp: ZoweDatasetNode;
        if (node.contextValue === extension.DS_MEMBER_CONTEXT) {
            if (node.getParent().contextValue === extension.DS_PDS_CONTEXT + extension.FAV_SUFFIX) {
                vscode.window.showInformationMessage(localize("addFavorite", "PDS already in favorites"));
                return;
            }
            this.addFavorite(node.getParent());
            return;
        } else if (node.contextValue === extension.DS_SESSION_CONTEXT) {
            temp = new ZoweDatasetNode("[" + node.getSessionNode().label.trim() + "]: " + node.pattern, vscode.TreeItemCollapsibleState.None,
                this.mFavoriteSession, node.getSession(), node.contextValue, node.getEtag(), node.getProfile());
            temp.contextValue = extension.DS_SESSION_CONTEXT + extension.FAV_SUFFIX;
            temp.iconPath =  applyIcons(temp);
            // add a command to execute the search
            temp.command = { command: "zowe.pattern", title: "", arguments: [temp] };
        } else {    // pds | ds
            temp = new ZoweDatasetNode("[" + node.getSessionNode().label.trim() + "]: " + node.label, node.collapsibleState,
                this.mFavoriteSession, node.getSession(), node.contextValue, node.getEtag(), node.getProfile());
            temp.contextValue += extension.FAV_SUFFIX;
            if (temp.contextValue === extension.DS_DS_CONTEXT + extension.FAV_SUFFIX) {
                temp.command = { command: "zowe.ZoweNode.openPS", title: "", arguments: [temp] };
            }
            temp.iconPath = applyIcons(temp);
        }
        if (!this.mFavorites.find((tempNode) =>
            (tempNode.label === temp.label) && (tempNode.contextValue === temp.contextValue)
        )) {
            this.mFavorites.push(temp);
            sortTreeItems(this.mFavorites, extension.DS_SESSION_CONTEXT + extension.FAV_SUFFIX);
            await this.updateFavorites();
            this.refreshElement(this.mFavoriteSession);
        }
    }

    /**
     * Renames a node based on the profile and it's label
     *
     * @param {string} profileLabel
     * @param {string} beforeLabel
     * @param {string} afterLabel
     */

    public async renameNode(profileLabel: string, beforeLabel: string, afterLabel: string) {
        const sessionNode = this.mSessionNodes.find((session) => session.label === `${profileLabel} `);
        if (sessionNode) {
            const matchingNode = sessionNode.children.find((node) => node.label === beforeLabel);
            if (matchingNode) {
                matchingNode.label = afterLabel;
                this.refreshElement(matchingNode);
            }
        }
    }

    /**
     * Renames a node from the favorites list
     *
     * @param {IZoweDatasetTreeNode} node
     */
    public async renameFavorite(node: IZoweDatasetTreeNode, newLabel: string) {
        const matchingNode = this.mFavorites.find(
            (temp) => (temp.label === node.label) && (temp.contextValue.startsWith(node.contextValue))
        );
        if (matchingNode) {
            const prefix = matchingNode.label.substring(0, matchingNode.label.indexOf(":") + 2);
            matchingNode.label = prefix + newLabel;
            this.refreshElement(matchingNode);
        }
    }

    /**
     * Finds the equivalent node as a favorite
     *
     * @param {IZoweDatasetTreeNode} node
     */
    public findFavoritedNode(node: IZoweDatasetTreeNode) {
        return this.mFavorites.find(
            (temp) => (temp.label === `[${node.getParent().getLabel()}]: ${node.label}`) && (temp.contextValue.includes(node.contextValue))
        );
    }
    /**
     * Finds the equivalent node not as a favorite
     *
     * @param {IZoweDatasetTreeNode} node
     */
    public findNonFavoritedNode(node: IZoweDatasetTreeNode) {
        const profileLabel = node.label.substring(1, node.label.indexOf("]"));
        const nodeLabel = node.label.substring(node.label.indexOf(":") + 2);
        const sessionNode = this.mSessionNodes.find((session) => session.label.trim() === profileLabel);
        return sessionNode.children.find((temp) => temp.label === nodeLabel);
    }

    /**
     * Removes a node from the favorites list
     *
     * @param {IZoweDatasetTreeNode} node
     */
    public async removeFavorite(node: IZoweDatasetTreeNode) {
        this.mFavorites = this.mFavorites.filter((temp) =>
            !((temp.label === node.label) && (temp.contextValue.startsWith(node.contextValue)))
        );
        this.refresh();
        await this.updateFavorites();
        this.refreshElement(this.mFavoriteSession);
    }

    public async updateFavorites() {
        const settings = this.mFavorites.map((fav) =>
            fav.label + "{" + fav.contextValue.substring(0, fav.contextValue.indexOf(extension.FAV_SUFFIX)) + "}"
        );
        this.mHistory.updateFavorites(settings);
    }

    public async onDidChangeConfiguration(e) {
            if (e.affectsConfiguration(DatasetTree.persistenceSchema)) {
                const setting: any = { ...vscode.workspace.getConfiguration().get(DatasetTree.persistenceSchema) };
                if (!setting.persistence) {
                    setting.favorites = [];
                    setting.history = [];
                    await vscode.workspace.getConfiguration().update(DatasetTree.persistenceSchema, setting, vscode.ConfigurationTarget.Global);
                }
            }
        }

    public async addHistory(criteria: string) {
        this.mHistory.addHistory(criteria);
        this.refresh();
    }

    public getHistory() {
        return this.mHistory.getHistory();
    }

    public async datasetFilterPrompt(node: IZoweDatasetTreeNode) {
        this.log.debug(localize("enterPattern.log.debug.prompt", "Prompting the user for a data set pattern"));
        let pattern: string;
        let usrNme: string;
        let passWrd: string;
        let baseEncd: string;
        let sesNamePrompt: string;
        if (node.contextValue.endsWith(extension.FAV_SUFFIX)) {
            sesNamePrompt = node.label.substring(1, node.label.indexOf("]"));
        } else {
            sesNamePrompt = node.label;
        }
        if ((!node.getSession().ISession.user) || (!node.getSession().ISession.password)) {
            try {
                const values = await Profiles.getInstance().promptCredentials(sesNamePrompt);
                if (values !== undefined) {
                    usrNme = values [0];
                    passWrd = values [1];
                    baseEncd = values [2];
                }
            } catch (error) {
                await errorHandling(error, node.getProfileName(),
                    localize("datasetTree.error", "Error encountered in ") + `datasetFilterPrompt.optionalProfiles!`);
            }
            if (usrNme !== undefined && passWrd !== undefined && baseEncd !== undefined) {
                node.getSession().ISession.user = usrNme;
                node.getSession().ISession.password = passWrd;
                node.getSession().ISession.base64EncodedAuth = baseEncd;
                this.validProfile = 0;
            } else {
                return;
            }
            await this.refreshElement(node);
            await this.refresh();
        } else {
            this.validProfile = 0;
        }
        if (this.validProfile === 0) {
            if (node.contextValue === extension.DS_SESSION_CONTEXT) {
                if (this.mHistory.getHistory().length > 0) {
                    const createPick = new FilterDescriptor(DatasetTree.defaultDialogText);
                    const items: vscode.QuickPickItem[] = this.mHistory.getHistory().map((element) => new FilterItem(element));
                    if (extension.ISTHEIA) {
                        const options1: vscode.QuickPickOptions = {
                            placeHolder: localize("searchHistory.options.prompt", "Select a filter")
                        };
                        // get user selection
                        const choice = (await vscode.window.showQuickPick([createPick, ...items], options1));
                        if (!choice) {
                            vscode.window.showInformationMessage(localize("enterPattern.pattern", "No selection made."));
                            return;
                        }
                        pattern = choice === createPick ? "" : choice.label;
                    } else {
                        const quickpick = vscode.window.createQuickPick();
                        quickpick.items = [createPick, ...items];
                        quickpick.placeholder = localize("searchHistory.options.prompt", "Select a filter");
                        quickpick.ignoreFocusOut = true;
                        quickpick.show();
                        const choice = await resolveQuickPickHelper(quickpick);
                        quickpick.hide();
                        if (!choice) {
                            vscode.window.showInformationMessage(localize("enterPattern.pattern", "No selection made."));
                            return;
                        }
                        if (choice instanceof FilterDescriptor) {
                            if (quickpick.value) {
                                pattern = quickpick.value;
                            }
                        } else {
                            pattern = choice.label;
                        }
                    }
                }
                if (!pattern) {
                    // manually entering a search
                    const options2: vscode.InputBoxOptions = {
                        prompt: localize("enterPattern.options.prompt",
                                            "Search data sets by entering patterns: use a comma to separate multiple patterns"),
                        value: node.pattern,
                    };
                    // get user input
                    pattern = await vscode.window.showInputBox(options2);
                    if (!pattern) {
                        vscode.window.showInformationMessage(localize("datasetFilterPrompt.enterPattern", "You must enter a pattern."));
                        return;
                    }
                }
            } else {
                // executing search from saved search in favorites
                pattern = node.label.trim().substring(node.getLabel().indexOf(":") + 2);
                const session = node.label.trim().substring(node.label.trim().indexOf("[") + 1, node.label.trim().indexOf("]"));
                await this.addSession(session);
                const faveNode = node;
                node = this.mSessionNodes.find((tempNode) => tempNode.label.trim() === session);
                if ((!node.getSession().ISession.user) || (!node.getSession().ISession.password)) {
                    node.getSession().ISession.user = faveNode.getSession().ISession.user;
                    node.getSession().ISession.password = faveNode.getSession().ISession.password;
                    node.getSession().ISession.base64EncodedAuth = faveNode.getSession().ISession.base64EncodedAuth;
                }
            }
            // update the treeview with the new pattern
            node.label = node.label.trim()+ " ";
            node.label.trim();
            node.tooltip = node.pattern = pattern.toUpperCase();
            node.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
            node.dirty = true;
            node.iconPath = applyIcons(node, extension.ICON_STATE_OPEN);
            this.addHistory(node.pattern);
        }
    }

    /**
     * Adds a single session to the data set tree
     *
     */
    private addSingleSession(profile: IProfileLoaded) {
        if (profile) {
            // If session is already added, do nothing
            if (this.mSessionNodes.find((tempNode) => tempNode.label.trim() === profile.name)) {
                return;
            }
            // Uses loaded profile to create a session with the MVS API
            const session = ZoweExplorerApiRegister.getMvsApi(profile).getSession();
            // Creates ZoweDatasetNode to track new session and pushes it to mSessionNodes
            const node = new ZoweDatasetNode(
                profile.name, vscode.TreeItemCollapsibleState.Collapsed, null, session, undefined, undefined, profile);
            node.contextValue = extension.DS_SESSION_CONTEXT;
            node.iconPath = applyIcons(node);
            this.mSessionNodes.push(node);
            this.mHistory.addSession(profile.name);
        }
    }
}
