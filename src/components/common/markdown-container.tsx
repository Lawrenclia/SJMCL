import {
  Accordion,
  AccordionButton,
  AccordionIcon,
  AccordionItem,
  AccordionPanel,
  Box,
  BoxProps,
  Card,
  Code,
  Divider,
  Heading,
  Icon,
  Image,
  Link,
  ListItem,
  OrderedList,
  Table,
  TableContainer,
  Tbody,
  Td,
  Text,
  Th,
  Thead,
  Tr,
  UnorderedList,
} from "@chakra-ui/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import React from "react";
import { useTranslation } from "react-i18next";
import { LuLightbulb } from "react-icons/lu";
import ReactMarkdown, { Components } from "react-markdown";
import { BeatLoader } from "react-spinners";
import remarkGfm from "remark-gfm";
import { ToolCallWidget } from "@/components/tool-call-widget";
import { useLauncherConfig } from "@/contexts/config";
import { findToolCalls, splitByToolCalls } from "@/utils/tool-call/parser";

type MarkdownContainerProps = BoxProps & {
  children: string;
  messageId?: string;
  onToolCallAction?: (action: "confirm" | "cancel") => void;
};

type ThinkSegment = {
  type: "normal" | "think";
  content: string;
  isFinished?: boolean;
  startIndex: number;
};

function splitThinkSegments(text: string): ThinkSegment[] {
  const segments: ThinkSegment[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    const openIdx = text.indexOf("<think>", cursor);
    if (openIdx === -1) {
      segments.push({
        type: "normal",
        content: text.slice(cursor),
        startIndex: cursor,
      });
      break;
    }

    if (openIdx > cursor) {
      segments.push({
        type: "normal",
        content: text.slice(cursor, openIdx),
        startIndex: cursor,
      });
    }

    const thinkContentStart = openIdx + "<think>".length;
    const closeIdx = text.indexOf("</think>", thinkContentStart);

    if (closeIdx === -1) {
      segments.push({
        type: "think",
        content: text.slice(thinkContentStart),
        isFinished: false,
        startIndex: thinkContentStart,
      });
      break;
    }

    segments.push({
      type: "think",
      content: text.slice(thinkContentStart, closeIdx),
      isFinished: true,
      startIndex: thinkContentStart,
    });
    cursor = closeIdx + "</think>".length;
  }

  return segments.filter((segment) => segment.content.trim().length > 0);
}

const JsonResponseCard: React.FC<{ content: string }> = ({ content }) => (
  <Card variant="outline" my={2} minW={0}>
    <Accordion allowToggle>
      <AccordionItem border="none">
        <AccordionButton>
          <Text flex={1} textAlign="left" fontSize="xs">
            JSON
          </Text>
          <AccordionIcon />
        </AccordionButton>
        <AccordionPanel pt={0}>
          <Code
            display="block"
            whiteSpace="pre-wrap"
            overflowWrap="anywhere"
            maxH="64"
            overflow="auto"
            p={2}
            fontSize="xs"
            className="allow-select"
            tabIndex={0}
          >
            {content}
          </Code>
        </AccordionPanel>
      </AccordionItem>
    </Accordion>
  </Card>
);

function isJsonContainer(content: string): boolean {
  try {
    const value = JSON.parse(content);
    return value !== null && typeof value === "object";
  } catch {
    return false;
  }
}

const MarkdownContainer: React.FC<MarkdownContainerProps> = ({
  children,
  messageId,
  onToolCallAction,
  ...boxProps
}) => {
  const { t } = useTranslation();
  const { config } = useLauncherConfig();
  const primaryColor = config.appearance.theme.primaryColor;
  const toolCallIndices = React.useMemo(
    () =>
      new Map(
        findToolCalls(children || "")
          .filter((call) => call.type === "success")
          .map((call, index) => [call.startIndex, index])
      ),
    [children]
  );

  // process GitHub-style mentions and issue / PR references
  const processGitHubMarks = React.useCallback(
    (text: string): React.ReactNode => {
      const parts = text.split(/(\#[0-9]+|\@[a-zA-Z0-9_-]+)/g);
      return parts.map((part, idx) => {
        if (/^#[0-9]+$/.test(part)) {
          const issueNumber = part.substring(1);
          return (
            <Link
              key={idx}
              color={`${primaryColor}.500`}
              onClick={() =>
                openUrl(
                  `https://github.com/UNIkeEN/SJMCL/pull/${issueNumber}`
                ).catch(logger.error)
              }
            >
              {part}
            </Link>
          );
        }
        if (/^@[a-zA-Z0-9_-]+$/.test(part)) {
          const username = part.substring(1);
          return (
            <Link
              key={idx}
              color={`${primaryColor}.500`}
              onClick={() =>
                openUrl(`https://github.com/${username}`).catch(logger.error)
              }
            >
              {part}
            </Link>
          );
        }
        return <React.Fragment key={idx}>{part}</React.Fragment>;
      });
    },
    [primaryColor]
  );

  // Process GitHub marks after tool calls have been separated from Markdown.
  const processContent = React.useCallback(
    (children: React.ReactNode): React.ReactNode => {
      if (typeof children === "string") {
        return processGitHubMarks(children);
      }

      if (Array.isArray(children)) {
        return children.map((child, i) => (
          <React.Fragment key={i}>{processContent(child)}</React.Fragment>
        ));
      }

      if (React.isValidElement(children)) {
        const childProps = children.props?.children ?? null;
        return React.cloneElement(children, {
          ...children.props,
          children: processContent(childProps),
        } as any);
      }

      return children;
    },
    [processGitHubMarks]
  );

  // map HTML tags to Chakra components so styles are inherited.
  const components: Components = React.useMemo(
    () => ({
      // paragraphs
      p: ({ node, children, ...rest }) => (
        <Text {...rest}>{processContent(children)}</Text>
      ),
      // headings
      h1: ({ node, children, ...rest }) => (
        <Heading as="h1" size="xl" my={4} {...rest}>
          {processContent(children)}
        </Heading>
      ),
      h2: ({ node, children, ...rest }) => (
        <Heading as="h2" size="lg" my={3} {...rest}>
          {processContent(children)}
        </Heading>
      ),
      h3: ({ node, children, ...rest }) => (
        <Heading as="h3" size="md" my={2} {...rest}>
          {children}
        </Heading>
      ),
      h4: ({ node, children, ...rest }) => (
        <Heading as="h4" size="sm" my={2} {...rest}>
          {children}
        </Heading>
      ),
      strong: ({ node, children, ...rest }) => (
        <Text as="strong" fontWeight="600" color="inherit" {...rest}>
          {processContent(children)}
        </Text>
      ),
      em: ({ node, children, ...rest }) => (
        <Text as="em" fontStyle="italic" color="inherit" {...rest}>
          {processContent(children)}
        </Text>
      ),
      // divider
      hr: ({ node, ...rest }) => <Divider my={4} {...rest} />,
      // links
      a: ({ node, href, children, ...rest }) => (
        <Link
          _hover={{ textDecoration: "underline" }}
          onClick={(e) => {
            e.preventDefault();
            if (href) openUrl(href);
          }}
          {...rest}
        >
          {children}
        </Link>
      ),
      // lists
      ul: ({ node, children, ...rest }) => (
        <UnorderedList pl={5} my={2} {...rest}>
          {processContent(children)}
        </UnorderedList>
      ),
      ol: ({ node, children, ...rest }) => (
        <OrderedList pl={5} my={2} {...rest}>
          {processContent(children)}
        </OrderedList>
      ),
      li: ({ node, children, ...rest }) => (
        <ListItem my={1} {...rest}>
          {processContent(children)}
        </ListItem>
      ),
      // images
      img: ({ node, src, alt, ...rest }) => (
        <Image
          src={src}
          alt={alt}
          maxW="100%"
          my={2}
          borderRadius="md"
          {...rest}
        />
      ),
      // tables
      table: ({ node, children, ...rest }) => (
        <TableContainer>
          <Table variant="simple" size="sm" {...rest}>
            {children}
          </Table>
        </TableContainer>
      ),
      thead: ({ node, children, ...rest }) => (
        <Thead {...rest}>{children}</Thead>
      ),
      tbody: ({ node, children, ...rest }) => (
        <Tbody {...rest}>{children}</Tbody>
      ),
      tr: ({ node, children, ...rest }) => <Tr {...rest}>{children}</Tr>,
      th: ({ node, children, ...rest }) => <Th {...rest}>{children}</Th>,
      td: ({ node, children, ...rest }) => <Td {...rest}>{children}</Td>,
      // code
      pre: ({ node, children, ...rest }) => {
        const child = React.Children.toArray(children)[0];
        const content = React.isValidElement<{ children?: React.ReactNode }>(
          child
        )
          ? child.props.children
          : undefined;
        if (typeof content === "string" && isJsonContainer(content)) {
          return <JsonResponseCard content={content.trim()} />;
        }
        return (
          <Box as="pre" overflowX="auto" {...rest}>
            {children}
          </Box>
        );
      },
      code: ({ node, className, children, ...rest }) => {
        return (
          <Code bg="unset" className={className} {...rest}>
            {children}
          </Code>
        );
      },
    }),

    [processContent]
  );

  const thinkSegments = React.useMemo(
    () => splitThinkSegments(children || ""),
    [children]
  );

  const renderMarkdown = React.useCallback(
    (content: string, key: string, startIndex = 0) => {
      if (isJsonContainer(content)) {
        return <JsonResponseCard key={key} content={content.trim()} />;
      }
      const segments = splitByToolCalls(content);
      // A model may wrap a tool call in a Markdown code fence or inline code.
      // Remove only the matching delimiters around that call.
      segments.forEach((segment, index) => {
        if (typeof segment === "string") return;
        const before = segments[index - 1];
        const after = segments[index + 1];
        if (typeof before !== "string" || typeof after !== "string") return;
        const fence = before.match(/(?:^|\n)\s*(```|~~~)[\w-]*\s*$/);
        if (fence && after.trimStart().startsWith(fence[1])) {
          segments[index - 1] = before.slice(0, fence.index);
          segments[index + 1] = after.trimStart().slice(fence[1].length);
        } else if (before.endsWith("`") && after.startsWith("`")) {
          segments[index - 1] = before.slice(0, -1);
          segments[index + 1] = after.slice(1);
        }
      });
      return segments.map((segment, index) => {
        if (typeof segment === "string") {
          return (
            <ReactMarkdown
              key={`${key}-text-${index}`}
              remarkPlugins={[remarkGfm]}
              components={components}
            >
              {segment}
            </ReactMarkdown>
          );
        }
        if (segment.type === "error") {
          return (
            <JsonResponseCard
              key={`${key}-error-${index}`}
              content={segment.raw}
            />
          );
        }
        const toolIndex = toolCallIndices.get(startIndex + segment.startIndex);
        return (
          <ToolCallWidget
            key={`${key}-tool-${segment.startIndex}`}
            data={{ name: segment.name, params: segment.params }}
            callId={
              messageId && toolIndex !== undefined
                ? `${messageId}-${toolIndex}`
                : undefined
            }
            onConfirmationAction={onToolCallAction}
          />
        );
      });
    },
    [components, messageId, onToolCallAction, toolCallIndices]
  );

  return (
    <Box {...boxProps}>
      {thinkSegments.length === 0
        ? renderMarkdown(children || "", "markdown-default")
        : thinkSegments.map((segment, index) => {
            if (segment.type === "normal") {
              return renderMarkdown(
                segment.content,
                `markdown-${index}`,
                segment.startIndex
              );
            }

            return (
              <Accordion key={`think-${index}`} allowToggle my={2}>
                <AccordionItem border="unset" borderRadius="md">
                  <AccordionButton px={0} py={2}>
                    {segment.isFinished ? (
                      <Icon size={4} as={LuLightbulb} />
                    ) : (
                      <BeatLoader size={4} />
                    )}
                    <Text
                      flex="1"
                      textAlign="left"
                      fontSize="sm"
                      fontWeight="600"
                      ml={2}
                    >
                      {segment.isFinished
                        ? t("AgentChatPage.thinkingFinished")
                        : t("AgentChatPage.thinking")}
                    </Text>
                    <AccordionIcon />
                  </AccordionButton>
                  <AccordionPanel px={0} pt={1} pb={3}>
                    {renderMarkdown(
                      segment.content,
                      `think-markdown-${index}`,
                      segment.startIndex
                    )}
                  </AccordionPanel>
                </AccordionItem>
              </Accordion>
            );
          })}
    </Box>
  );
};

export default React.memo(MarkdownContainer);
