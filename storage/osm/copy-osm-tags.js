#!/usr/bin/env node

import fs from 'fs/promises';
import path from 'path';

const TAG_KEY_PATTERN = /(name|brand|operator)/i;

function parseAttributes(attributeText) {
  const attributes = {};
  const attributePattern = /([A-Za-z_:][A-Za-z0-9_:\-\.]*)=(['"])(.*?)\2/g;
  let match;

  while ((match = attributePattern.exec(attributeText)) !== null) {
    attributes[match[1]] = match[3];
  }

  return attributes;
}

function parseObjects(xmlText) {
  const lines = xmlText.split(/\r?\n/);
  const objects = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const startMatch = line.match(/^(\s*)<(node|way|relation)\b([^>]*?)(\/?)>\s*$/);

    if (!startMatch) {
      index += 1;
      continue;
    }

    const type = startMatch[2];
    const attributes = parseAttributes(startMatch[3]);
    const id = attributes.id;
    const selfClosing = startMatch[4] === '/';

    if (!id) {
      throw new Error(`Could not find id attribute for ${type} at line ${index + 1}`);
    }

    if (selfClosing) {
      objects.push({ type, id, startIndex: index, endIndex: index, lines: [line], selfClosing: true });
      index += 1;
      continue;
    }

    const objectLines = [line];
    let cursor = index + 1;

    while (cursor < lines.length) {
      objectLines.push(lines[cursor]);
      if (new RegExp(`^\\s*</${type}>\\s*$`).test(lines[cursor])) {
        break;
      }
      cursor += 1;
    }

    if (cursor >= lines.length || !new RegExp(`^\\s*</${type}>\\s*$`).test(lines[cursor])) {
      throw new Error(`Missing closing </${type}> for ${type} ${id}`);
    }

    objects.push({ type, id, startIndex: index, endIndex: cursor, lines: objectLines, selfClosing: false });
    index = cursor + 1;
  }

  return { lines, objects };
}

function extractCopyableTags(objectLines) {
  return objectLines.filter((line) => /<tag\b/.test(line) && TAG_KEY_PATTERN.test(line));
}

function getObjectKey(object) {
  return `${object.type}:${object.id}`;
}

function replaceTagsInObject(object, tagsToCopy) {
  if (!tagsToCopy.length) {
    return object.lines.slice();
  }

  if (object.selfClosing) {
    const startLine = object.lines[0].replace(/\/\s*>\s*$/, '>');
    return [startLine, ...tagsToCopy, `</${object.type}>`];
  }

  const updatedLines = [];
  const removableIndices = [];
  let insertionIndex = -1;

  for (let lineIndex = 0; lineIndex < object.lines.length; lineIndex += 1) {
    const line = object.lines[lineIndex];
    if (lineIndex === 0) {
      updatedLines.push(line);
      continue;
    }

    const isClosingLine = new RegExp(`^\\s*</${object.type}>\\s*$`).test(line);
    if (isClosingLine) {
      if (insertionIndex === -1) {
        insertionIndex = updatedLines.length;
      }
      updatedLines.push(line);
      continue;
    }

    if (/<tag\b/.test(line) && TAG_KEY_PATTERN.test(line)) {
      if (insertionIndex === -1) {
        insertionIndex = updatedLines.length;
      }
      continue;
    }

    updatedLines.push(line);
  }

  if (insertionIndex === -1) {
    insertionIndex = updatedLines.length;
  }

  updatedLines.splice(insertionIndex, 0, ...tagsToCopy);
  return updatedLines;
}

async function main() {
  const [, , sourcePathArg, targetPathArg, outputPathArg] = process.argv;
  const sourcePath = path.resolve(sourcePathArg || 'map.osm');
  const targetPath = path.resolve(targetPathArg || '7.osm');
  const outputPath = path.resolve(outputPathArg || '7.fixed.osm');

  const [sourceText, targetText] = await Promise.all([
    fs.readFile(sourcePath, 'utf8'),
    fs.readFile(targetPath, 'utf8'),
  ]);

  const sourceDocument = parseObjects(sourceText);
  const targetDocument = parseObjects(targetText);

  const sourceTagMap = new Map();
  for (const object of sourceDocument.objects) {
    const key = getObjectKey(object);
    sourceTagMap.set(key, extractCopyableTags(object.lines));
  }

  let copiedObjectCount = 0;
  let copiedTagCount = 0;
  const mergedLines = targetDocument.lines.slice();

  for (const object of [...targetDocument.objects].reverse()) {
    const key = getObjectKey(object);
    const tagsToCopy = sourceTagMap.get(key) || [];
    if (!tagsToCopy.length) {
      continue;
    }

    const replacementLines = replaceTagsInObject(object, tagsToCopy);
    mergedLines.splice(object.startIndex, object.endIndex - object.startIndex + 1, ...replacementLines);
    copiedObjectCount += 1;
    copiedTagCount += tagsToCopy.length;
  }

  await fs.writeFile(outputPath, mergedLines.join('\n'), 'utf8');
  console.log(`Copied ${copiedTagCount} tags across ${copiedObjectCount} objects.`);
  console.log(`Wrote ${outputPath}`);
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});