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
	icon?: string;
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

interface ListChatsOptions {
	boardId?: string;
	page?: number;
	pageSize?: number;
}

interface RawBoard {
	id?: string;
	name?: string;
	description?: string;
	icon?: string;
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
		icon: typeof raw.icon === 'string' ? raw.icon : undefined,
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

	async listBoards(forceRefresh = false): Promise<Board[]> {
		if (!forceRefresh && isCacheValid(boardListCache)) {
			return boardListCache.data;
		}

		const raw = await this.request<RawBoard[] | { data?: RawBoard[] }>('/listBoards', {});
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
}
