import { bundledChatGPTModels } from "./bundled-models";
import { ChatGPTError } from "./api";
import { createChatGPTService } from "./service";

export async function requireChatGPTModel(
  environment: Pick<Env, "DB" | "CHATGPT_TOKEN_ENCRYPTION_KEY">,
  userId: string,
  modelId: string,
) {
  await createChatGPTService(environment).requireConnection(userId);
  const model = bundledChatGPTModels.find((model) => model.id === modelId);
  if (!model) throw new ChatGPTError("This model is not supported. Choose another model.", 400);
  return model;
}
