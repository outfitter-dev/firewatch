import { Command } from "commander";

import { commentCommand, prCommentAction } from "./comment";
import { editCommand } from "./edit";
import { listCommand } from "./list";
import { reviewCommand } from "./review";

export const prCommand = new Command("pr")
  .description("GitHub PR operations (gh-aligned)")
  .addCommand(listCommand)
  .addCommand(editCommand)
  .addCommand(commentCommand)
  .addCommand(reviewCommand);

export { prCommentAction };
