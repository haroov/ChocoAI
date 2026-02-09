/* eslint-disable max-len */

export const en = {
  Common: {
    loading: 'Loading',
    search: 'Search',
    tryAgain: 'Try again',
    edit: 'Edit',
    delete: 'Delete',
    ok: 'Ok',
    cancel: 'Cancel',
    confirm: 'Confirm',
    save: 'Save',
    create: 'Create',
    refresh: 'Refresh',
    confirmAction: 'Confirm action',
    confirmDeletionMsg: 'Are you sure you want to delete this item? This action cannot be undone.',
  },

  MainLayout: {
    conversations: 'Conversations',
    settings: 'Settings',
    systemTheme: 'System theme',
    lightTheme: 'Light theme',
    darkTheme: 'Dark theme',
    about: 'About',
    version: 'Version: {version}',
    logout: 'Logout',
  },

  LoginPage: {
    signIn: 'Sign in',
    authorizedAccessRequired: 'Authorized access required',
    username: 'Username',
    password: 'Password',
    signInBtn: 'Sign in',
    signInBtnLoading: 'Signing in...',
    needHelpMsg: 'Need help? See <link>README</link> or contact admin.',
    fillUsernameAndPassword: 'Please fill username and password',
    loginFailed: 'Login failed',
  },

  ConversationsPage: {
    conversations: 'Conversations',
    new: 'New',
    failedToLoadConversations: 'Failed to load conversations',
    noConversationsYet: 'No conversations yet',
    noMessagesYet: 'No messages yet',
    selectConversation: 'Select a conversation',
    failedToFetchConversation: 'Failed to fetch conversation',
    typeAMessage: 'Type a message',
    failedToCreateConversation: 'Failed to create conversation',
    conversationDetails: 'Conversation details',
    flow: 'Flow',
    userData: 'User data',
    log: 'Log',
    request: 'Request',
    response: 'Response',
    collected: 'Collected',
    organisations: 'Organisations',
  },

  SettingsPage: {
    settings: 'Settings',
    dashboard: 'Dashboard',
    aiProvider: 'AI provider',
    flows: 'Flows',
    whatsapp: 'WhatsApp',
    email: 'Email',
    webWidget: 'Web widget',
    system: 'System',

    sectionWasNotFound: 'Section was not found',

    // Dashboard

    // AI Provider
    model: 'Model',

    // Flows
    newFlow: 'New flow',
    failedToLoadFlows: 'Failed to load flows',
    createFlow: 'Create flow',
    export: 'Export',
    name: 'Name',
    slug: 'Slug',
    description: 'Description',
    failedToCreateFlow: 'Failed to create flow',
    failedToDeleteFlow: 'Failed to delete flow',

    // WhatsApp

    // Web Widget

    // System
    healthStatus: 'Health status',
    checkedAt: 'Checked {lastCheckedAt}',
  },

  FlowEditor: {
    backToList: 'Back to list',
    name: 'Name',
    slug: 'Slug',
    description: 'Description',
    general: 'General',
    canvas: 'Canvas',
    fields: 'Fields',
    schemaJSON: 'Schema JSON',
    validationWithCount: 'Validation ({errorCount})',
    defileFlowLevelFieldsMsg: 'Define flow-level fields used in stages.',
    noFieldsYetMsg: 'No fields yet. Add your first field.',
    addField: 'Add field',
    searchFields: 'Search fields',
    sortByPriority: 'Toggle sort by priority',
    type: 'Type',
    string: 'String',
    enum: 'Enum',
    number: 'Number',
    boolean: 'Boolean',
    allowedValues: 'Allowed values (comma-separated)',
    sensitive: 'Sensitive',

    palette: 'Palette',
    addStage: 'Add stage',
    setInitial: 'Set initial',
    stage: 'Stage',
    selectStageToSeeDetails: 'Select a stage to see its details',
    action: 'Action',
    when: 'When',
    fieldsToCollect: 'Fields to collect',
    transition: 'Transition',
    fallback: 'Fallback',
    if: 'If',
    true: 'True',
    false: 'False',
    stageSettings: 'Stage settings',
    prompt: 'Prompt',
    basics: 'Basics',
    noFieldsDefinedYet: 'No flow fields defined yet',
    toolToExecute: 'Tool to execute',
    condition: 'Condition',
    nextStage: 'Next stage',
    transitionType: 'Transition type',
    fixed: 'Fixed',
    conditional: 'Conditional',
    addCondition: 'Add condition',
    ifTrue: 'If true',
    ifFalse: 'If false',
    patternRegex: 'Pattern (regex)',
    minLength: 'Min. length',
    maxLength: 'Max. length',
    priority: 'Priority',

    validation: 'Validation',
    noIssues: 'No issues',
    focus: 'Focus',
    initialStageIsNotSet: 'Initial stage is not set',
    initialStageNotExist: 'Initial stage points to a non-existent node',
    edgePointsToMissingStage: 'Edge points to missing stage: {stage}',
    unreachableStage: 'Unreachable stage: {stage}',

    // Missing field references repair
    missingFieldRefsMsg: 'This stage references fields that are missing from the flow definition. Remove them, or create definitions so the flow can be saved.',
    createFieldDefinition: 'Create',
    removeFieldRef: 'Remove',
    createdFieldDefinition: 'Created field definition: {slug}',
    autoCreatedMissingFieldsForSave: 'Auto-created {count} missing field definition(s) so the flow can be saved.',
  },

  Notification: {
    info: 'Info',
    success: 'Success',
    warning: 'Warning',
    error: 'Error',
  },

  ApplicationError: {
    unexpectedError: 'Unexpected error',
    applicationError: 'Application error',
    unknownApplicationErrorMsg: 'Unexpected error.\n'
      + 'We are already working on fix. You can go to home screen or contact support.',
    goToHomeScreen: 'Go to home screen',
    pageWasNotFound: 'Page was not found',
    pageProbablyWasDeletedOrMoved: 'Probably page was deleted or moved',
    networkError: 'Network error',
    networkErrorMsg: 'Probably server is unavailable or it\'s a problem with your connection. Check your internet connect and try again later.',
  },

  Errors: {},
};
