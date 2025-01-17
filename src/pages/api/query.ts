// 引入所需模块
import type { NextApiRequest, NextApiResponse } from "next";
import { Readable } from "stream";
import SerperApi from "../../utils/serper.api";
import OpenAI from "openai";

/**
 * 入口：处理API请求，根据用户问题获取相关上下文并调用OpenAI生成回答和相关问题。
 * @param {NextApiRequest} req 请求对象。
 * @param {NextApiResponse} res 响应对象。
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const { query, rid } = req.body;

  // 第一步：获取与用户问题相关的数据
  const serperData = await SerperApi(query);

  // 创建一个Readable流用于响应
  const readable = new Readable({ read() {} });
  const initialPayload = createInitialPayload(query, rid, serperData);
  readable.push(initialPayload);

  // 第二步：将获得的数据发送给OpenAI处理
  const openai = initializeOpenAI();
  const stream = await requestOpenAICompletion(openai, query, serperData);

  // 读取并处理OpenAI返回的流数据
  for await (const chunk of stream) {
    readable.push(chunk.choices[0]?.delta?.content || "");
  }

  // 第三步：生成相关问题
  const relatedQuestions = await generateRelatedQuestions(
    openai,
    query,
    serperData,
  );
  readable.push("\n\n__RELATED_QUESTIONS__\n\n");
  readable.push(JSON.stringify(relatedQuestions));

  readable.push(null); // 结束流

  // 设置响应头并将流内容发送给客户端
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Transfer-Encoding", "chunked");
  readable.pipe(res);
}

/**
 * 初始化OpenAI客户端。
 * @returns {OpenAI} OpenAI客户端实例。
 */
function initializeOpenAI() {
  return new OpenAI({
    apiKey: process.env.API_KEY,
    baseURL: process.env.BASE_URL,
  });
}

/**
 * 创建初始请求负载。
 * @param {string} query 用户查询。
 * @param {string} rid 请求ID。
 * @param {Object[]} serperData 从SerperApi获取的数据。
 * @returns {string} 初始请求负载。
 */
function createInitialPayload(query: string, rid: string, serperData: any) {
  return `{"query": "${query}", "rid": "${rid}", "contexts": ${JSON.stringify(serperData)}}\n\n__LLM_RESPONSE__\n\n`;
}

/**
 * 请求OpenAI生成回答。
 * @param {OpenAI} openai OpenAI客户端实例。
 * @param {string} query 用户查询。
 * @param {Object[]} serperData 从SerperApi获取的数据。
 * @returns {AsyncIterableIterator<any>} OpenAI生成回答的流。
 */
async function requestOpenAICompletion(
  openai: OpenAI,
  query: string,
  serperData: any,
) {
  return openai.chat.completions.create({
    model: process.env.CHAT_MODEL || "gpt-3.5-turbo",
    messages: createOpenAIMessages(query, serperData),
    stream: true,
  });
}

/**
 * 根据用户查询和相关上下文生成OpenAI请求的消息体。
 * @param {string} query 用户查询。
 * @param {Object[]} serperData 相关上下文数据。
 * @returns {Object[]} OpenAI请求的消息体。
 */
function createOpenAIMessages(query: string, serperData: any): any {
  const systemMessageContent = generateSystemMessageContent(serperData);
  return [
    { role: "system", content: systemMessageContent },
    { role: "user", content: query },
  ];
}

/**
 * 生成系统消息内容。
 * @param {Object[]} serperData 相关上下文数据。
 * @returns {string} 系统消息内容。
 */
function generateSystemMessageContent(serperData: any) {
  return `You are a large language AI assistant built by CodeMoss AI. ... Here are the set of contexts:\n\n${serperData.map((c: any) => c.snippet).join("\n\n")}\n\nRemember, don't blindly repeat the contexts verbatim. And here is the user question: \n\n`;
}

/**
 * 根据用户原始查询和相关上下文生成相关问题。
 * @param {OpenAI} openai OpenAI客户端实例。
 * @param {string} query 用户查询。
 * @param {Object[]} serperData 相关上下文数据。
 * @returns {Promise<Object[]>} 相关问题的数组。
 */
async function generateRelatedQuestions(
  openai: OpenAI,
  query: string,
  serperData: any,
) {
  const chatCompletion = await openai.chat.completions.create({
    model: process.env.CHAT_MODEL || "gpt-3.5-turbo",
    messages: createOpenAIMessages(query, serperData),
  });
  return transformString(chatCompletion.choices[0].message.content);
}

/**
 * 工具函数：将字符串按行分割，并转换为问题对象数组。
 * @param {any} str 待转换的字符串。
 * @returns {Object[]} 转换后的问题对象数组。
 */
function transformString(str: any) {
  return str.split("\n").map((line: any) => ({ question: line }));
}
