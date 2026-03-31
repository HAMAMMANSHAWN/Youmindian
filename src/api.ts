import { requestUrl } from 'obsidian';

const BASE_URL = 'https://youmind.com/openapi/v1';
const BOARD_CACHE_TTL = 5 * 60 * 1000;

interface CacheEntry<T> {
	data: T;
	timestamp: number;
}

let boardListCache: CacheEntry<Board[]> | null = null;
let defaultBoardCache: CacheEntry<Board | null> | null = null;

function isCacheValid<T>(entry: CacheEntry<T> | null): entry is CacheEntry<T> {
	return entry !== null && Date.now() - entry.timestamp < BOARD_CACHE_TTL;
}

export interface Board {
	id: string;
	name: string;
	description?: string;
	icon?: {
		name?: string;
		color?: string;
	} | string;
	coverUrl?: string;
	isDefault?: boolean;
	createdAt?: string;
	updatedAt?: string;
}

export interface BoardContextState {
	currentBoard: Board | null;
	boards: Board[];
	isLoading: boolean;
	error: string | null;
}

export interface ChatOrigin {
	type: 'snip' | 'board' | 'thought' | 'unknown' | 'webpage' | 'craft';
	id?: string;
	url?: string;
	title?: string;
	content?: string;
	description?: string;
}

export type ChatStatus = 'not-started' | 'answering' | 'thinking' | 'completed';
export type ChatMode = 'chat' | 'new_board' | 'custom_assistant' | 'assistant_preview';

export interface Chat {
	id: string;
	creatorId?: string;
	createdAt: string;
	updatedAt: string;
	title: string;
	origin: ChatOrigin;
	boardId?: string;
	mode?: ChatMode | string;
	showNewBoardSuggestion?: boolean;
	newBoardChatId?: string;
	status?: ChatStatus;
	hasUnread: boolean;
}

export interface ChatListResponse {
	data: Chat[];
	total: number;
	page: number;
	pageSize: number;
}

export interface MessageBlock {
	type: 'content' | 'text' | 'tool_call' | 'tool_result' | string;
	data: string;
	[key: string]: unknown;
}

export interface BaseMessage {
	id?: string;
	role: 'user' | 'assistant';
	createdAt?: string;
	updatedAt?: string;
}

export interface UserMessage extends BaseMessage {
	role: 'user';
	content: string;
}

export interface AssistantMessage extends BaseMessage {
	role: 'assistant';
	$class?: string;
	content?: string;
	text?: string;
	blocks?: MessageBlock[];
	status?: string;
	model?: string;
}

export type Message = UserMessage | AssistantMessage;
export type ChatResponse = Chat & { messages: Message[] };
export type SendMessageResponse = ChatResponse;

export interface MessageListResponse {
	messages: Message[];
	total: number;
}

export interface CreateChatParams {
	boardId?: string;
	chatModel: string;
	messageMode: 'ask' | 'agent' | 'workflow';
}

export interface SendMessageParams {
	chatId: string;
	content: string;
	chatModel: string;
	messageMode: 'ask' | 'agent' | 'workflow';
	atReferences?: string[];
}

export interface CreatePickParams {
	boardId: string;
	content: {
		raw: string;
		plain?: string;
	};
	source?: {
		entityType: 'chat';
		entityId: string;
		selection?: {
			matchText: string;
			selectedBy: 'USER';
			pickSelectionMessageId?: string;
		};
		quote?: {
			raw: string;
			plain: string;
		};
	};
}

export interface NoteDto {
	id: string;
	title: string;
	content: string;
	type: string;
	boardId?: string;
	position?: {
		boardId: string;
		rank: string;
		boardItemId: string;
	};
}

export interface MaterialListItem {
	boardItemId: string;
	entityType: string;
	entity: {
		id: string;
		type: string;
		title: string;
		content?: string;
		url?: string;
		updatedAt?: string;
		visibility?: string;
	};
	parentBoardGroupId?: string;
	rank?: string;
}

export interface MaterialDto {
	id: string;
	type: string;
	title: string;
	content?: string;
	url?: string;
	blocks?: Array<Record<string, unknown>>;
	updatedAt?: string;
	[key: string]: unknown;
}

export interface CraftDto {
	id: string;
	type: string;
	title: string;
	content?: string;
	boardId?: string;
	groupId?: string;
	updatedAt?: string;
	[key: string]: unknown;
}

export interface SearchResult {
	id: string;
	type: string;
	title: string;
	snippet?: string;
	score?: number;
	[key: string]: unknown;
}

interface ListChatsOptions {
	boardId?: string;
	page?: number;
	pageSize?: number;
}

interface RawBoard {
	id?: string;
	name?: string;
	description?: string;
	icon?: string | { name?: string; color?: string; [key: string]: unknown };
	cover_url?: string;
	coverUrl?: string;
	is_default?: boolean;
	isDefault?: boolean;
	created_at?: string;
	createdAt?: string;
	updated_at?: string;
	updatedAt?: string;
	[key: string]: unknown;
}

interface RawChat {
	id?: string;
	creator_id?: string;
	creatorId?: string;
	created_at?: string;
	createdAt?: string;
	updated_at?: string;
	updatedAt?: string;
	title?: string;
	origin?: ChatOrigin;
	board_id?: string;
	boardId?: string;
	mode?: string;
	show_new_board_suggestion?: boolean;
	showNewBoardSuggestion?: boolean;
	new_board_chat_id?: string;
	newBoardChatId?: string;
	status?: ChatStatus;
	has_unread?: boolean;
	hasUnread?: boolean;
	[key: string]: unknown;
}

interface RawMessage {
	id?: string;
	role?: 'user' | 'assistant';
	$class?: string;
	created_at?: string;
	createdAt?: string;
	updated_at?: string;
	updatedAt?: string;
	content?: string;
	message?: string;
	text?: string;
	blocks?: Array<{ type?: string; data?: string; [key: string]: unknown }>;
	status?: string;
	model?: string;
	[key: string]: unknown;
}

function normalizeBoard(raw: RawBoard): Board {
	return {
		id: raw.id ?? '',
		name: raw.name ?? 'Untitled board',
		description: typeof raw.description === 'string' ? raw.description : undefined,
		icon:
			typeof raw.icon === 'string'
				? raw.icon
				: raw.icon && typeof raw.icon === 'object'
					? {
							name: typeof raw.icon.name === 'string' ? raw.icon.name : undefined,
							color: typeof raw.icon.color === 'string' ? raw.icon.color : undefined,
						}
					: undefined,
		coverUrl:
			typeof raw.coverUrl === 'string'
				? raw.coverUrl
				: typeof raw.cover_url === 'string'
					? raw.cover_url
					: undefined,
		isDefault:
			typeof raw.isDefault === 'boolean'
				? raw.isDefault
				: typeof raw.is_default === 'boolean'
					? raw.is_default
					: undefined,
		createdAt:
			typeof raw.createdAt === 'string'
				? raw.createdAt
				: typeof raw.created_at === 'string'
					? raw.created_at
					: undefined,
		updatedAt:
			typeof raw.updatedAt === 'string'
				? raw.updatedAt
				: typeof raw.updated_at === 'string'
					? raw.updated_at
					: undefined,
	};
}

function normalizeChatOrigin(raw: unknown): ChatOrigin {
	if (!raw || typeof raw !== 'object') {
		return { type: 'unknown' };
	}
	const value = raw as Record<string, unknown>;
	return {
		type: (typeof value.type === 'string' ? value.type : 'unknown') as ChatOrigin['type'],
		id: typeof value.id === 'string' ? value.id : undefined,
		url: typeof value.url === 'string' ? value.url : undefined,
		title: typeof value.title === 'string' ? value.title : undefined,
		content: typeof value.content === 'string' ? value.content : undefined,
		description: typeof value.description === 'string' ? value.description : undefined,
	};
}

function normalizeChat(raw: RawChat): Chat {
	return {
		id: raw.id ?? '',
		creatorId:
			typeof raw.creatorId === 'string'
				? raw.creatorId
				: typeof raw.creator_id === 'string'
					? raw.creator_id
					: undefined,
		createdAt:
			typeof raw.createdAt === 'string'
				? raw.createdAt
				: typeof raw.created_at === 'string'
					? raw.created_at
					: '',
		updatedAt:
			typeof raw.updatedAt === 'string'
				? raw.updatedAt
				: typeof raw.updated_at === 'string'
					? raw.updated_at
					: '',
		title: raw.title ?? 'Untitled',
		origin: normalizeChatOrigin(raw.origin),
		boardId:
			typeof raw.boardId === 'string'
				? raw.boardId
				: typeof raw.board_id === 'string'
					? raw.board_id
					: undefined,
		mode: typeof raw.mode === 'string' ? raw.mode : undefined,
		showNewBoardSuggestion:
			typeof raw.showNewBoardSuggestion === 'boolean'
				? raw.showNewBoardSuggestion
				: typeof raw.show_new_board_suggestion === 'boolean'
					? raw.show_new_board_suggestion
					: undefined,
		newBoardChatId:
			typeof raw.newBoardChatId === 'string'
				? raw.newBoardChatId
				: typeof raw.new_board_chat_id === 'string'
					? raw.new_board_chat_id
					: undefined,
		status: raw.status,
		hasUnread:
			typeof raw.hasUnread === 'boolean'
				? raw.hasUnread
				: typeof raw.has_unread === 'boolean'
					? raw.has_unread
					: false,
	};
}

function normalizeMessage(raw: RawMessage): Message {
	const role = raw.role === 'assistant' ? 'assistant' : 'user';
	const createdAt =
		typeof raw.createdAt === 'string'
			? raw.createdAt
			: typeof raw.created_at === 'string'
				? raw.created_at
				: undefined;
	const updatedAt =
		typeof raw.updatedAt === 'string'
			? raw.updatedAt
			: typeof raw.updated_at === 'string'
				? raw.updated_at
				: undefined;

	if (role === 'assistant') {
		return {
			id: raw.id,
			role,
			createdAt,
			updatedAt,
			$class: raw.$class,
			content: typeof raw.content === 'string' ? raw.content : undefined,
			text: typeof raw.text === 'string' ? raw.text : undefined,
			status: typeof raw.status === 'string' ? raw.status : undefined,
			model: typeof raw.model === 'string' ? raw.model : undefined,
			blocks: Array.isArray(raw.blocks)
				? raw.blocks
						.filter((block) => typeof block?.data === 'string')
						.map((block) => ({
							type: typeof block.type === 'string' ? block.type : 'content',
							data: block.data as string,
						}))
				: undefined,
		};
	}

	return {
		id: raw.id,
		role,
		createdAt,
		updatedAt,
		content:
			typeof raw.content === 'string'
				? raw.content
				: typeof raw.message === 'string'
					? raw.message
				: typeof raw.text === 'string'
					? raw.text
					: '',
	};
}

export function extractAssistantContent(message: AssistantMessage | Message): string {
	if (message.role !== 'assistant') {
		return '';
	}

	if (Array.isArray(message.blocks) && message.blocks.length > 0) {
		const text = message.blocks
			.filter((block) => block.type === 'content' || block.type === 'text')
			.map((block) => block.data)
			.join('\n');
		if (text) {
			return text;
		}
	}

	if (typeof message.content === 'string' && message.content) {
		return message.content;
	}

	return typeof message.text === 'string' ? message.text : '';
}

export function invalidateBoardCache(): void {
	boardListCache = null;
	defaultBoardCache = null;
}

export class YouMindAPI {
	private apiKey: string;

	constructor(apiKey: string) {
		this.apiKey = apiKey;
	}

	setApiKey(apiKey: string): void {
		this.apiKey = apiKey;
	}

	private async request<T>(path: string, body: Record<string, unknown> = {}): Promise<T> {
		const response = await requestUrl({
			url: `${BASE_URL}${path}`,
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'x-api-key': this.apiKey,
				Authorization: `Bearer ${this.apiKey}`,
			},
			body: JSON.stringify(body),
		});

		if (response.status < 200 || response.status >= 300) {
			throw new Error(`YouMind API error ${response.status}: POST ${path} — ${JSON.stringify(response.json)}`);
		}

		return response.json as T;
	}

	async createChat(message: string, params: CreateChatParams): Promise<ChatResponse> {
		const raw = await this.request<RawChat & { messages?: RawMessage[] }>('/createChat', {
			message,
			board_id: params.boardId,
			chat_model: params.chatModel,
			message_mode: params.messageMode,
		});
		return {
			...normalizeChat(raw),
			messages: Array.isArray(raw.messages) ? raw.messages.map(normalizeMessage) : [],
		};
	}

	async sendMessage(params: SendMessageParams): Promise<SendMessageResponse> {
		const raw = await this.request<RawChat & { messages?: RawMessage[] }>('/sendMessage', {
			chat_id: params.chatId,
			message: params.content,
			chat_model: params.chatModel,
			message_mode: params.messageMode,
			at_references: params.atReferences,
		});
		return {
			...normalizeChat(raw),
			messages: Array.isArray(raw.messages) ? raw.messages.map(normalizeMessage) : [],
		};
	}

	async listChats(options?: ListChatsOptions): Promise<ChatListResponse> {
		const raw = await this.request<{ data?: RawChat[]; total?: number; page?: number; pageSize?: number }>(
			'/listChats',
			{
				board_id: options?.boardId,
				page: options?.page ?? 0,
				page_size: options?.pageSize ?? 20,
			},
		);

		const data = Array.isArray(raw.data) ? raw.data.map(normalizeChat) : [];
		return {
			data,
			total: typeof raw.total === 'number' ? raw.total : data.length,
			page: typeof raw.page === 'number' ? raw.page : options?.page ?? 0,
			pageSize: typeof raw.pageSize === 'number' ? raw.pageSize : options?.pageSize ?? 20,
		};
	}

	async getChat(chatId: string): Promise<Chat> {
		const raw = await this.request<RawChat>('/getChat', {
			chat_id: chatId,
		});
		return normalizeChat(raw);
	}

	async listMessages(chatId: string): Promise<MessageListResponse> {
		const raw = await this.request<{ messages?: RawMessage[]; total?: number }>('/listMessages', {
			chat_id: chatId,
		});
		const messages = Array.isArray(raw.messages) ? raw.messages.map(normalizeMessage) : [];
		return {
			messages,
			total: typeof raw.total === 'number' ? raw.total : messages.length,
		};
	}

	async listBoards(
		options?: boolean | { status?: string; fuzzyName?: string; withFavorite?: boolean; forceRefresh?: boolean },
	): Promise<Board[]> {
		const forceRefresh = typeof options === 'boolean' ? options : (options?.forceRefresh ?? false);
		if (!forceRefresh && isCacheValid(boardListCache)) {
			return boardListCache.data;
		}

		const requestBody =
			typeof options === 'boolean' || !options
				? {}
				: {
						status: options.status,
						fuzzy_name: options.fuzzyName,
						with_favorite: options.withFavorite,
					};
		const raw = await this.request<RawBoard[] | { data?: RawBoard[] }>('/listBoards', requestBody);
		const boards = (Array.isArray(raw) ? raw : Array.isArray(raw.data) ? raw.data : []).map(normalizeBoard);
		boardListCache = { data: boards, timestamp: Date.now() };
		return boards;
	}

	async getBoard(boardId: string): Promise<Board> {
		const raw = await this.request<RawBoard>('/getBoard', {
			board_id: boardId,
		});
		return normalizeBoard(raw);
	}

	async getDefaultBoard(forceRefresh = false): Promise<Board | null> {
		if (!forceRefresh && isCacheValid(defaultBoardCache)) {
			return defaultBoardCache.data;
		}

		try {
			const raw = await this.request<RawBoard | null>('/getDefaultBoard', {});
			const board = raw ? normalizeBoard(raw) : null;
			defaultBoardCache = { data: board, timestamp: Date.now() };
			return board;
		} catch {
			defaultBoardCache = { data: null, timestamp: Date.now() };
			return null;
		}
	}

	async validateApiKey(): Promise<boolean> {
		try {
			await this.listBoards(true);
			return true;
		} catch {
			return false;
		}
	}

	async createPick(params: CreatePickParams): Promise<{ id: string }> {
		return this.request<{ id: string }>('/createPick', params as unknown as Record<string, unknown>);
	}

	async createNote(params: {
		content: string;
		title?: string;
		boardId?: string;
		parentBoardGroupId?: string;
		genTitle?: boolean;
	}): Promise<NoteDto> {
		return this.request<NoteDto>('/createNote', {
			content: params.content,
			title: params.title,
			board_id: params.boardId,
			parent_board_group_id: params.parentBoardGroupId,
			gen_title: params.genTitle,
		});
	}

	async updateNote(params: {
		id: string;
		title?: string;
		content?: string;
		titleType?: 'default' | 'ai' | 'manual';
	}): Promise<NoteDto> {
		return this.request<NoteDto>('/updateNote', {
			id: params.id,
			title: params.title,
			content: params.content,
			title_type: params.titleType,
		});
	}

	async listMaterials(params: { boardId: string; groupId?: string }): Promise<MaterialListItem[]> {
		const raw = await this.request<Array<Record<string, unknown>>>('/listMaterials', {
			board_id: params.boardId,
			group_id: params.groupId,
		});
		return raw.map((item) => ({
			boardItemId: typeof item.boardItemId === 'string' ? item.boardItemId : typeof item.board_item_id === 'string' ? item.board_item_id : '',
			entityType: typeof item.entityType === 'string' ? item.entityType : typeof item.entity_type === 'string' ? item.entity_type : '',
			entity: typeof item.entity === 'object' && item.entity ? (item.entity as MaterialListItem['entity']) : { id: '', type: '', title: 'Untitled' },
			parentBoardGroupId:
				typeof item.parentBoardGroupId === 'string'
					? item.parentBoardGroupId
					: typeof item.parent_board_group_id === 'string'
						? item.parent_board_group_id
						: undefined,
			rank: typeof item.rank === 'string' ? item.rank : undefined,
		}));
	}

	async getMaterial(params: { id: string; includeBlocks?: boolean }): Promise<MaterialDto> {
		return this.request<MaterialDto>('/getMaterial', {
			id: params.id,
			include_blocks: params.includeBlocks,
		});
	}

	async listCrafts(params: { boardId: string; groupId?: string }): Promise<CraftDto[]> {
		return this.request<CraftDto[]>('/listCrafts', {
			board_id: params.boardId,
			group_id: params.groupId,
		});
	}

	async getCraft(params: { id: string; withChildren?: boolean }): Promise<CraftDto> {
		return this.request<CraftDto>('/getCraft', {
			id: params.id,
			with_children: params.withChildren,
		});
	}

	async moveMaterials(params: {
		items: Array<{
			id: string;
			boardId: string;
			groupId?: string;
		}>;
	}): Promise<{
		successCount: number;
		failedCount: number;
		failures?: string[];
	}> {
		return this.request('/moveMaterials', {
			items: params.items.map((item) => ({
				id: item.id,
				board_id: item.boardId,
				group_id: item.groupId,
			})),
		});
	}

	async search(params: {
		scope: 'library' | 'board';
		query: string;
		boardId?: string;
		topK?: number;
	}): Promise<{ results: SearchResult[]; total: number }> {
		return this.request<{ results: SearchResult[]; total: number }>('/search', {
			scope: params.scope,
			query: params.query,
			board_id: params.boardId,
			top_k: params.topK,
		});
	}
}
