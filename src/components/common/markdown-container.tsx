import {
  Box,
  BoxProps,
  Code,
  Divider,
  Heading,
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
import ReactMarkdown, { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { FunctionCallWidget } from "@/components/function-call-widget";
import { useLauncherConfig } from "@/contexts/config";

type MarkdownContainerProps = BoxProps & {
  children: string;
  onFunctionCall?: (
    name: string,
    params: Record<string, any>
  ) => Promise<any> | void;
};

const MarkdownContainer: React.FC<MarkdownContainerProps> = ({
  children,
  onFunctionCall,
  ...boxProps
}) => {
  const { config } = useLauncherConfig();
  const primaryColor = config.appearance.theme.primaryColor;

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

  // Process both function calls and GitHub marks
  const processContent = React.useCallback(
    (children: React.ReactNode): React.ReactNode => {
      if (typeof children === "string") {
        const result: React.ReactNode[] = [];
        let remaining = children;

        while (true) {
          const marker = "::function::";
          const idx = remaining.indexOf(marker);

          if (idx === -1) {
            result.push(processGitHubMarks(remaining));
            break;
          }

          // Push text before marker
          if (idx > 0) {
            result.push(processGitHubMarks(remaining.substring(0, idx)));
          }

          // Try to parse JSON starting after marker
          const jsonStart = remaining.indexOf("{", idx + marker.length);
          if (jsonStart === -1) {
            // No opening brace found, treat text up to marker end as resolved
            result.push(
              processGitHubMarks(remaining.substring(idx, idx + marker.length))
            );
            remaining = remaining.substring(idx + marker.length);
            continue;
          }

          // Check if there's only whitespace between marker and {
          const textBetween = remaining.substring(
            idx + marker.length,
            jsonStart
          );
          if (textBetween.trim() !== "") {
            // Invalid format, treat as normal text
            result.push(
              processGitHubMarks(remaining.substring(idx, jsonStart))
            );
            remaining = remaining.substring(jsonStart);
            continue;
          }

          // Brace counting to find full JSON object with support for nesting
          let braceCount = 0;
          let jsonEnd = -1;
          for (let i = jsonStart; i < remaining.length; i++) {
            if (remaining[i] === "{") braceCount++;
            else if (remaining[i] === "}") {
              braceCount--;
              if (braceCount === 0) {
                jsonEnd = i + 1;
                break;
              }
            }
          }

          if (jsonEnd !== -1) {
            const jsonStr = remaining.substring(jsonStart, jsonEnd);
            try {
              const data = JSON.parse(jsonStr);
              if (data.name) {
                result.push(
                  <FunctionCallWidget key={`fn-${result.length}`} data={data} />
                );
              } else {
                result.push(
                  <Code
                    key={`err-${result.length}`}
                    colorScheme="red"
                    fontSize="xs"
                  >
                    Invalid Call: {jsonStr}
                  </Code>
                );
              }
            } catch (e) {
              result.push(
                <Code
                  key={`err-${result.length}`}
                  colorScheme="red"
                  fontSize="xs"
                >
                  Invalid JSON: {jsonStr}
                </Code>
              );
            }
            remaining = remaining.substring(jsonEnd);
          } else {
            // Unclosed brace, treat the marker as text and continue
            result.push(
              processGitHubMarks(remaining.substring(idx, jsonStart + 1))
            );
            remaining = remaining.substring(jsonStart + 1);
          }
        }
        return result;
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
      code: ({ node, className, children, ...rest }) => {
        // If inline code matches function pattern
        if (typeof children === "string") {
          const funcMatch = children.match(/^::function::(\{.*\})$/);
          if (funcMatch) {
            try {
              const data = JSON.parse(funcMatch[1]);
              return <FunctionCallWidget data={data} />;
            } catch (e) {
              // ignore
            }
          }
        }

        return (
          <Code className={className} {...rest}>
            {children}
          </Code>
        );
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [processContent]
  );

  return (
    <Box {...boxProps}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children || ""}
      </ReactMarkdown>
    </Box>
  );
};

export default MarkdownContainer;
