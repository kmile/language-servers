/*!
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
    AuthFollowUpClickedParams,
    CopyCodeToClipboardParams,
    ErrorParams,
    GenericCommandParams,
    InsertToCursorPositionParams,
    SendToPromptParams,
    TriggerType,
    isValidAuthFollowUpType,
} from '@aws/chat-client-ui-types'
import {
    ChatMessage,
    ChatResult,
    ContextCommand,
    ContextCommandParams,
    ConversationClickResult,
    FeedbackParams,
    FollowUpClickParams,
    InfoLinkClickParams,
    LinkClickParams,
    ListConversationsResult,
    OpenTabParams,
    SourceLinkClickParams,
} from '@aws/language-server-runtimes-types'
import {
    ChatItem,
    ChatItemType,
    ChatPrompt,
    MynahUI,
    MynahUIDataModel,
    NotificationType,
    MynahUIProps,
    QuickActionCommand,
} from '@aws/mynah-ui'
import { VoteParams } from '../contracts/telemetry'
import { Messager } from './messager'
import { TabFactory } from './tabs/tabFactory'
import { disclaimerAcknowledgeButtonId, disclaimerCard } from './texts/disclaimer'
import { ChatClientAdapter, ChatEventHandler } from '../contracts/chatClientAdapter'
import { withAdapter } from './withAdapter'
import { toMynahIcon } from './utils'
import { ChatHistory, ChatHistoryList } from './features/history'

export interface InboundChatApi {
    addChatResponse(params: ChatResult, tabId: string, isPartialResult: boolean): void
    sendToPrompt(params: SendToPromptParams): void
    sendGenericCommand(params: GenericCommandParams): void
    showError(params: ErrorParams): void
    openTab(requestId: string, params: OpenTabParams): void
    sendContextCommands(params: ContextCommandParams): void
    listConversations(params: ListConversationsResult): void
    conversationClicked(params: ConversationClickResult): void
}

type ContextCommandGroups = MynahUIDataModel['contextCommands']

const ContextPrompt = {
    CreateItemId: 'create-saved-prompt',
    CancelButtonId: 'cancel-create-prompt',
    SubmitButtonId: 'submit-create-prompt',
    PromptNameFieldId: 'prompt-name',
} as const

export const handleChatPrompt = (
    mynahUi: MynahUI,
    tabId: string,
    prompt: ChatPrompt,
    messager: Messager,
    triggerType?: TriggerType,
    _eventId?: string
) => {
    let userPrompt = prompt.escapedPrompt
    if (prompt.command) {
        // Temporary solution to handle clear quick actions on the client side
        if (prompt.command === '/clear') {
            mynahUi.updateStore(tabId, {
                chatItems: [],
            })
        } else if (prompt.command === '/help') {
            userPrompt = DEFAULT_HELP_PROMPT
        }

        // Send prompt when quick action command attached
        messager.onQuickActionCommand({
            quickAction: prompt.command,
            prompt: userPrompt,
            tabId,
        })

        if (prompt.command === '/clear') {
            return
        }
    } else {
        // Send chat prompt to server
        messager.onChatPrompt({ prompt, tabId }, triggerType)
    }
    // Add user prompt to UI
    mynahUi.addChatItem(tabId, {
        type: ChatItemType.PROMPT,
        body: userPrompt,
    })

    // Set UI to loading state
    mynahUi.updateStore(tabId, {
        loadingChat: true,
        promptInputDisabledState: true,
    })

    // Create initial empty response
    mynahUi.addChatItem(tabId, {
        type: ChatItemType.ANSWER_STREAM,
    })
}

export const createMynahUi = (
    messager: Messager,
    tabFactory: TabFactory,
    disclaimerAcknowledged: boolean,
    customChatClientAdapter?: ChatClientAdapter
): [MynahUI, InboundChatApi] => {
    const initialTabId = TabFactory.generateUniqueId()
    let disclaimerCardActive = !disclaimerAcknowledged
    let contextCommandGroups: ContextCommandGroups | undefined

    let chatEventHandlers: ChatEventHandler = {
        onCodeInsertToCursorPosition(
            tabId,
            messageId,
            code,
            type,
            referenceTrackerInformation,
            eventId,
            codeBlockIndex,
            totalCodeBlocks
        ) {
            const payload: InsertToCursorPositionParams = {
                tabId,
                messageId,
                code,
                type,
                referenceTrackerInformation,
                eventId,
                codeBlockIndex,
                totalCodeBlocks,
            }
            messager.onInsertToCursorPosition(payload)
        },
        onFocusStateChanged(focusState: boolean) {
            messager.onFocusStateChanged(focusState)
        },
        onFollowUpClicked(tabId, messageId, followUp, eventId) {
            if (followUp.type !== undefined && isValidAuthFollowUpType(followUp.type)) {
                const payload: AuthFollowUpClickedParams = {
                    tabId,
                    messageId,
                    authFollowupType: followUp.type,
                }
                messager.onAuthFollowUpClicked(payload)
                mynahUi.updateStore(tabId, { promptInputDisabledState: false })
            } else {
                const prompt = followUp.prompt ? followUp.prompt : followUp.pillText
                handleChatPrompt(mynahUi, tabId, { prompt: prompt, escapedPrompt: prompt }, messager, 'click', eventId)

                const payload: FollowUpClickParams = {
                    tabId,
                    messageId,
                    followUp,
                }
                messager.onFollowUpClicked(payload)
            }
        },
        onChatPrompt(tabId, prompt, eventId) {
            handleChatPrompt(mynahUi, tabId, prompt, messager, 'click', eventId)
        },
        onReady: () => {
            messager.onUiReady()
            messager.onTabAdd(initialTabId)
        },
        onFileClick: (tabId: string, filePath: string) => {
            messager.onFileClick({ tabId, filePath })
        },
        onTabAdd: (tabId: string) => {
            const defaultTabConfig: Partial<MynahUIDataModel> = {
                quickActionCommands: tabFactory.getDefaultTabData().quickActionCommands,
                contextCommands: contextCommandGroups,
                ...(disclaimerCardActive ? { promptInputStickyCard: disclaimerCard } : {}),
            }
            mynahUi.updateStore(tabId, defaultTabConfig)
            messager.onTabAdd(tabId)
        },
        onTabRemove: (tabId: string) => {
            messager.onTabRemove(tabId)
        },
        onTabChange: (tabId: string) => {
            messager.onTabChange(tabId)
        },
        onResetStore: () => {},
        onCopyCodeToClipboard: (
            tabId,
            messageId,
            code,
            type,
            referenceTrackerInformation,
            eventId,
            codeBlockIndex,
            totalCodeBlocks
        ) => {
            const payload: CopyCodeToClipboardParams = {
                tabId,
                messageId,
                code,
                type,
                referenceTrackerInformation,
                eventId,
                codeBlockIndex,
                totalCodeBlocks,
            }
            messager.onCopyCodeToClipboard(payload)
        },
        onVote: (tabId, messageId, vote, eventId) => {
            const payload: VoteParams = {
                tabId,
                messageId,
                vote,
                eventId,
            }
            messager.onVote(payload)
        },
        onSendFeedback: (tabId, feedbackPayload, eventId) => {
            const payload: FeedbackParams = {
                tabId,
                feedbackPayload,
                eventId,
            }
            messager.onSendFeedback(payload)

            mynahUi.notify({
                type: NotificationType.INFO,
                title: 'Your feedback is sent',
                content: 'Thanks for your feedback.',
            })
        },
        onLinkClick: (tabId, messageId, link, mouseEvent, eventId) => {
            mouseEvent?.preventDefault()
            mouseEvent?.stopPropagation()
            mouseEvent?.stopImmediatePropagation()

            const payload: LinkClickParams = {
                tabId,
                messageId,
                link,
                eventId,
            }
            messager.onLinkClick(payload)
        },
        onSourceLinkClick: (tabId, messageId, link, mouseEvent, eventId) => {
            mouseEvent?.preventDefault()
            mouseEvent?.stopPropagation()
            mouseEvent?.stopImmediatePropagation()

            const payload: SourceLinkClickParams = {
                tabId,
                messageId,
                link,
                eventId,
            }
            messager.onSourceLinkClick(payload)
        },
        onInfoLinkClick: (tabId, link, mouseEvent, eventId) => {
            mouseEvent?.preventDefault()
            mouseEvent?.stopPropagation()
            mouseEvent?.stopImmediatePropagation()

            const payload: InfoLinkClickParams = {
                tabId,
                link,
                eventId,
            }
            messager.onInfoLinkClick(payload)
        },
        onInBodyButtonClicked: (tabId, messageId, action, eventId) => {
            if (action.id === disclaimerAcknowledgeButtonId) {
                // Hide the legal disclaimer card
                disclaimerCardActive = false

                // Update the disclaimer getting acknowledged
                messager.onDisclaimerAcknowledged()

                // Remove all disclaimer cards from all tabs
                Object.keys(mynahUi.getAllTabs()).forEach(storeTabKey => {
                    mynahUi.updateStore(storeTabKey, { promptInputStickyCard: null })
                })
            }
        },
        onContextSelected: (contextItem, tabId) => {
            if (contextItem.id === ContextPrompt.CreateItemId) {
                mynahUi.showCustomForm(
                    tabId,
                    [
                        {
                            id: ContextPrompt.PromptNameFieldId,
                            type: 'textinput',
                            mandatory: true,
                            autoFocus: true,
                            title: 'Prompt name',
                            placeholder: 'Enter prompt name',
                            description: "Use this prompt by typing '@' followed by the prompt name.",
                        },
                    ],
                    [
                        { id: ContextPrompt.CancelButtonId, text: 'Cancel', status: 'clear' },
                        { id: ContextPrompt.SubmitButtonId, text: 'Create', status: 'main' },
                    ],
                    `Create a saved prompt`
                )
                return false
            }
            return true
        },
        onCustomFormAction: (tabId, action) => {
            if (action.id === ContextPrompt.SubmitButtonId) {
                messager.onCreatePrompt(action.formItemValues![ContextPrompt.PromptNameFieldId])
            }
        },
        onFormTextualItemKeyPress: (event: KeyboardEvent, formData: Record<string, string>, itemId: string) => {
            if (itemId === ContextPrompt.PromptNameFieldId && event.key === 'Enter') {
                event.preventDefault()
                messager.onCreatePrompt(formData[ContextPrompt.PromptNameFieldId])
                return true
            }
            return false
        },
        onTabBarButtonClick: (tabId: string, buttonId: string) => {
            if (buttonId === ChatHistory.TabBarButtonId) {
                messager.onListConversations()
                return
            }
            throw new Error(`Unhandled tab bar button id: ${buttonId}`)
        },
    }

    const mynahUiProps: MynahUIProps = {
        tabs: {
            [initialTabId]: {
                isSelected: true,
                store: tabFactory.createTab(true, disclaimerCardActive),
            },
        },
        defaults: {
            store: tabFactory.createTab(true, false),
        },
        config: {
            maxTabs: 10,
            texts: uiComponentsTexts,
        },
    }

    const mynahUiRef = { mynahUI: undefined as MynahUI | undefined }
    if (customChatClientAdapter) {
        // Attach routing to custom adapter top of default message handlers
        chatEventHandlers = withAdapter(chatEventHandlers, mynahUiRef, customChatClientAdapter)
    }

    const mynahUi = new MynahUI({
        ...mynahUiProps,
        ...chatEventHandlers,
    })
    mynahUiRef.mynahUI = mynahUi

    const getTabStore = (tabId = mynahUi.getSelectedTabId()) => {
        return tabId ? mynahUi.getAllTabs()[tabId]?.store : undefined
    }

    const createTabId = (needWelcomeMessages: boolean = false, chatMessages?: ChatMessage[]) => {
        const tabId = mynahUi.updateStore(
            '',
            tabFactory.createTab(needWelcomeMessages, disclaimerCardActive, chatMessages)
        )
        if (tabId === undefined) {
            mynahUi.notify({
                content: uiComponentsTexts.noMoreTabsTooltip,
                type: NotificationType.WARNING,
            })
            return undefined
        }

        return tabId
    }

    const getOrCreateTabId = () => {
        const tabId = mynahUi.getSelectedTabId()

        return tabId ?? createTabId()
    }

    const addChatResponse = (chatResult: ChatResult, tabId: string, isPartialResult: boolean) => {
        const { type, ...chatResultWithoutType } = chatResult
        let header = undefined

        if (chatResult.contextList !== undefined) {
            header = {
                fileList: {
                    fileTreeTitle: '',
                    filePaths: chatResult.contextList.filePaths?.map(file => file),
                    rootFolderTitle: 'Context',
                    flatList: true,
                    collapsed: true,
                    hideFileCount: true,
                    details: Object.fromEntries(
                        Object.entries(chatResult.contextList.details || {}).map(([filePath, fileDetails]) => [
                            filePath,
                            {
                                label:
                                    fileDetails.lineRanges
                                        ?.map(range =>
                                            range.first === -1 || range.second === -1
                                                ? ''
                                                : `line ${range.first} - ${range.second}`
                                        )
                                        .join(', ') || '',
                                description: filePath,
                                clickable: true,
                            },
                        ])
                    ),
                },
            }
        }

        if (isPartialResult) {
            // type for MynahUI differs from ChatResult types so we ignore it
            mynahUi.updateLastChatAnswer(tabId, { ...chatResultWithoutType, header: header })
            return
        }

        // If chat response from server is an empty object don't do anything
        if (Object.keys(chatResult).length === 0) {
            return
        }

        // If the response is auth follow-up show it as a system prompt
        const followUpOptions = chatResult.followUp?.options
        const isValidAuthFollowUp =
            followUpOptions &&
            followUpOptions.length > 0 &&
            followUpOptions[0].type &&
            isValidAuthFollowUpType(followUpOptions[0].type)
        if (chatResult.body === '' && isValidAuthFollowUp) {
            mynahUi.addChatItem(tabId, {
                type: ChatItemType.SYSTEM_PROMPT,
                ...chatResultWithoutType, // type for MynahUI differs from ChatResult types so we ignore it
            })

            // TODO, prompt should be disabled until user is authenticated
            // Currently we don't have a mechanism to notify chat-client about auth changes
            // mynahUi.updateStore(tabId, { promptInputDisabledState: true })
            return
        }

        const followUps = chatResult.followUp
            ? {
                  text: chatResult.followUp.text ?? 'Suggested follow up questions:',
                  options: chatResult.followUp.options,
              }
            : {}

        mynahUi.updateLastChatAnswer(tabId, {
            header: header,
            body: chatResult.body,
            messageId: chatResult.messageId,
            followUp: followUps,
            relatedContent: chatResult.relatedContent,
            canBeVoted: chatResult.canBeVoted,
        })

        mynahUi.endMessageStream(tabId, chatResult.messageId ?? '')

        mynahUi.updateStore(tabId, {
            loadingChat: false,
            promptInputDisabledState: false,
        })
    }

    const sendToPrompt = (params: SendToPromptParams) => {
        const tabId = getOrCreateTabId()
        if (!tabId) return

        mynahUi.addToUserPrompt(tabId, params.selection, 'code')
        messager.onSendToPrompt(params, tabId)
    }

    const sendGenericCommand = (params: GenericCommandParams) => {
        let tabId = getOrCreateTabId()

        if (!tabId) return

        // send to a new tab if the current tab is loading
        if (getTabStore(tabId)?.loadingChat) {
            tabId = createTabId()
            if (!tabId) return
        }

        const body = [
            params.genericCommand,
            ' the following part of my code:',
            '\n~~~~\n',
            params.selection,
            '\n~~~~\n',
        ].join('')
        const chatPrompt: ChatPrompt = { prompt: body, escapedPrompt: body }

        handleChatPrompt(mynahUi, tabId, chatPrompt, messager, params.triggerType)
    }

    const showError = (params: ErrorParams) => {
        const tabId = getOrCreateTabId()
        if (!tabId) return

        const answer: ChatItem = {
            type: ChatItemType.ANSWER,
            body: `**${params.title}** 
${params.message}`,
        }

        mynahUi.updateStore(tabId, {
            loadingChat: false,
            promptInputDisabledState: false,
        })

        mynahUi.addChatItem(params.tabId, answer)
        messager.onError(params)
    }

    const openTab = (requestId: string, params: OpenTabParams) => {
        if (params.tabId) {
            if (params.tabId !== mynahUi.getSelectedTabId()) {
                mynahUi.selectTab(params.tabId)
            }
            messager.onOpenTab(requestId, { tabId: params.tabId })
        } else {
            const messages = params.newTabOptions?.data?.messages
            const tabId = createTabId(messages ? false : true, messages)
            if (tabId) {
                messager.onOpenTab(requestId, { tabId })
            } else {
                messager.onOpenTab(requestId, {
                    type: 'InvalidRequest',
                    message: 'No more tabs available',
                })
            }
        }
    }

    const toContextCommands = (commands: ContextCommand[]): QuickActionCommand[] => {
        return commands.map(command => ({
            ...command,
            children: command.children?.map(child => ({
                ...child,
                commands: toContextCommands(child.commands),
            })),
            icon: toMynahIcon(command.icon),
        }))
    }

    const sendContextCommands = (params: ContextCommandParams) => {
        contextCommandGroups = params.contextCommandGroups.map(group => ({
            ...group,
            commands: toContextCommands(group.commands),
        }))

        Object.keys(mynahUi.getAllTabs()).forEach(tabId => {
            mynahUi.updateStore(tabId, {
                contextCommands: contextCommandGroups,
            })
        })
    }

    const chatHistoryList = new ChatHistoryList(mynahUi, messager)
    const listConversations = (params: ListConversationsResult) => {
        chatHistoryList.show(params)
    }

    const conversationClicked = (params: ConversationClickResult) => {
        if (!params.success) {
            mynahUi.notify({
                content: `Failed to ${params.action ?? 'open'} the history`,
                type: NotificationType.ERROR,
            })
            return
        }

        // close history list if conversation item was successfully opened
        if (!params.action) {
            chatHistoryList.close()
            return
        }
        // request update conversations list if conversation item was successfully deleted
        if (params.action === 'delete') {
            messager.onListConversations()
        }
    }

    const api = {
        addChatResponse: addChatResponse,
        sendToPrompt: sendToPrompt,
        sendGenericCommand: sendGenericCommand,
        showError: showError,
        openTab: openTab,
        sendContextCommands: sendContextCommands,
        listConversations: listConversations,
        conversationClicked: conversationClicked,
    }

    return [mynahUi, api]
}

export const DEFAULT_HELP_PROMPT = 'What can Amazon Q help me with?'
const uiComponentsTexts = {
    mainTitle: 'Amazon Q (Preview)',
    copy: 'Copy',
    insertAtCursorLabel: 'Insert at cursor',
    feedbackFormTitle: 'Report an issue',
    feedbackFormOptionsLabel: 'What type of issue would you like to report?',
    feedbackFormCommentLabel: 'Description of issue (optional):',
    feedbackThanks: 'Thanks for your feedback!',
    feedbackReportButtonLabel: 'Report an issue',
    codeSuggestions: 'Code suggestions',
    files: 'file(s)',
    clickFileToViewDiff: 'Click on a file to view diff.',
    showMore: 'Show more',
    save: 'Save',
    cancel: 'Cancel',
    submit: 'Submit',
    stopGenerating: 'Stop generating',
    copyToClipboard: 'Copied to clipboard',
    noMoreTabsTooltip: 'You can only open ten conversation tabs at a time.',
    codeSuggestionWithReferenceTitle: 'Some suggestions contain code with references.',
    spinnerText: 'Generating your answer...',
}
