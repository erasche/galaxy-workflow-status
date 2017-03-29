#!/usr/bin/env python
import argparse
import os
import json
import logging
from tqdm import tqdm
import datetime
from bioblend import galaxy


logging.basicConfig(format='[%(asctime)s][%(lineno)d][%(module)s] %(message)s', level=logging.DEBUG)
logging.getLogger("requests").setLevel(logging.WARNING)
logging.getLogger("bioblend").setLevel(logging.WARNING)
NOW = datetime.datetime.now()
SCRIPT_DIR = os.path.dirname(os.path.realpath(__file__))
BUILD_ID = os.environ.get('BUILD_NUMBER', 'Manual')

def __main__():
    parser = argparse.ArgumentParser(description="""Script to run all workflows mentioned in workflows_to_test.
    It will import the shared workflows are create histories for each workflow run, prefixed with ``TEST_RUN_<date>:``
    Make sure the yaml has file names identical to those in the data library.""")

    parser.add_argument('-k', '--api-key', '--key', dest='key', metavar='your_api_key',
                        help='The account linked to this key needs to have admin right to upload by server path',
                        required=True)
    parser.add_argument('-u', '--url', dest='url', metavar="http://galaxy_url:port",
                        help="Be sure to specify the port on which galaxy is running",
                        default="http://usegalaxy.org")
    parser.add_argument('-w', '--workflow-output', dest="workflow_output", type=str, default='out.ga',
                        help="""Location to store Galaxy workflow in""")
    parser.add_argument('-i', '--workflow-id', dest="workflow_id", type=str)
    args = parser.parse_args()

    gi = galaxy.GalaxyInstance(args.url, args.key)
    wf = gi.workflows.get_workflows(workflow_id=args.workflow_id)[0]

    gi.workflows.export_workflow_to_local_path(args.workflow_id, args.workflow_output, use_default_filename=False)
    # Get the current invocations
    invocations = gi.workflows.get_invocations(args.workflow_id)
    workflow_states = {}
    for invocation in tqdm(invocations):
        invoke = gi.workflows.show_invocation(wf['id'], invocation['id'])

        workflow_states[invocation['id']] = {}
        for step in invoke['steps']:
            sid = step['workflow_step_uuid']
            if sid == 'None':
                sid = step['order_index']

            workflow_states[invocation['id']][sid] = step['state']

    print(json.dumps(workflow_states, sort_keys=True, indent=2))


if __name__ == "__main__":
    __main__()
