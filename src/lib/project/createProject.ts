import fs from "fs-extra";
import path from "path";
import os from "os";
import stripInvalidFilenameCharacters from "lib/helpers/stripInvalidFilenameCharacters";
import { projectTemplatesRoot } from "lib/pathConsts";
import copy from "lib/helpers/fsCopy";
import { ERR_PROJECT_EXISTS } from "shared/consts";

export interface CreateProjectInput {
  name: string;
  template: string;
  path: string;
}

const createProject = async (input: CreateProjectInput) => {
  const projectFolderName = stripInvalidFilenameCharacters(input.name);
  const projectPath = path.join(input.path, projectFolderName);
  const templatePath = `${projectTemplatesRoot}/${input.template}`;
  const projectTmpDataPath = `${projectPath}/project.gbsproj`;
  const projectDataPath = `${projectPath}/${projectFolderName}.gbsproj`;
  const { username } = os.userInfo();

  if (fs.existsSync(projectPath)) {
    throw ERR_PROJECT_EXISTS;
  }

  await fs.ensureDir(projectPath);
  await copy(templatePath, projectPath);

  // Replace placeholders in data file
  const dataFile = (await fs.readFile(projectTmpDataPath, "utf8"))
    .replace(/___PROJECT_NAME___/g, projectFolderName)
    .replace(/___AUTHOR___/g, username);

  await fs.writeFile(projectDataPath, dataFile);
  await fs.unlink(projectTmpDataPath);
  return projectDataPath;
};

export default createProject;
