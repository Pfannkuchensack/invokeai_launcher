import {
  Box,
  Button,
  Flex,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  Text,
} from '@invoke-ai/ui-library';
import { useStore } from '@nanostores/react';
import { startCase } from 'es-toolkit/compat';
import { memo, useCallback } from 'react';

import { XTermLogViewer } from '@/renderer/features/XTermLogViewer/XTermLogViewer';
import { XTermLogViewerStatusIndicator } from '@/renderer/features/XTermLogViewer/XTermLogViewerStatusIndicator';
import type { ScriptInfo } from '@/shared/types';

import {
  $availableScripts,
  $isScriptRunnerOpen,
  $scriptProcessStatus,
  $scriptProcessXTerm,
  $selectedScript,
  closeScriptRunner,
  runSelectedScript,
  stopScript,
  teardownScriptTerminal,
} from './state';

type Props = {
  installLocation: string;
};

export const ScriptRunner = memo(({ installLocation }: Props) => {
  const isOpen = useStore($isScriptRunnerOpen);
  const scripts = useStore($availableScripts);
  const selectedScript = useStore($selectedScript);
  const status = useStore($scriptProcessStatus);

  const isRunning = status.type === 'running';

  const onClose = useCallback(() => {
    if (!isRunning) {
      teardownScriptTerminal();
    }
    closeScriptRunner();
  }, [isRunning]);

  const onRun = useCallback(() => {
    runSelectedScript(installLocation);
  }, [installLocation]);

  const onStop = useCallback(() => {
    stopScript();
  }, []);

  return (
    <Modal isOpen={isOpen} onClose={onClose} isCentered size="xl">
      <ModalOverlay bg="transparent" backdropFilter="auto" backdropBlur="32px">
        <Box position="absolute" inset={0} bg="base.900" opacity={0.7} />
      </ModalOverlay>
      <ModalContent maxW="700px" h="500px">
        <ModalHeader>Scripts</ModalHeader>
        <ModalCloseButton />
        <ModalBody as={Flex} flexDir="column" gap={4} w="full" h="full" minH={0} overflow="hidden">
          {scripts.length === 0 ? (
            <Text color="base.400">No scripts found in this installation.</Text>
          ) : (
            <>
              <ScriptSelector />
              <Box flex={1} minH={0}>
                <ScriptLogViewer />
              </Box>
            </>
          )}
        </ModalBody>
        <ModalFooter gap={2}>
          {isRunning ? (
            <Button onClick={onStop} colorScheme="error">
              Stop
            </Button>
          ) : (
            <Button onClick={onRun} colorScheme="invokeYellow" isDisabled={!selectedScript || scripts.length === 0}>
              Run
            </Button>
          )}
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
});
ScriptRunner.displayName = 'ScriptRunner';

const ScriptSelector = memo(() => {
  const scripts = useStore($availableScripts);
  const status = useStore($scriptProcessStatus);
  const isRunning = status.type === 'running';

  return (
    <Flex gap={2} flexWrap="wrap">
      {scripts.map((script) => (
        <ScriptButton key={script.path} script={script} isDisabled={isRunning} />
      ))}
    </Flex>
  );
});
ScriptSelector.displayName = 'ScriptSelector';

const ScriptButton = memo(({ script, isDisabled }: { script: ScriptInfo; isDisabled: boolean }) => {
  const selectedScript = useStore($selectedScript);
  const onClick = useCallback(() => {
    $selectedScript.set(script);
  }, [script]);

  return (
    <Button
      size="sm"
      variant="outline"
      colorScheme={selectedScript?.path === script.path ? 'invokeBlue' : 'base'}
      onClick={onClick}
      isDisabled={isDisabled}
    >
      {script.name}
    </Button>
  );
});
ScriptButton.displayName = 'ScriptButton';

const ScriptLogViewer = memo(() => {
  const status = useStore($scriptProcessStatus);

  const getMessage = (type: string) => {
    if (type === 'idle') {
      return 'Select a script and click Run';
    }
    return startCase(type);
  };

  return (
    <XTermLogViewer $xterm={$scriptProcessXTerm}>
      <XTermLogViewerStatusIndicator isLoading={status.type === 'running'} position="absolute" top={2} right={2}>
        {getMessage(status.type)}
      </XTermLogViewerStatusIndicator>
    </XTermLogViewer>
  );
});
ScriptLogViewer.displayName = 'ScriptLogViewer';
