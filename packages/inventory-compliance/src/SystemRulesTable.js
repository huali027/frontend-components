import React from 'react';
import propTypes from 'prop-types';
import * as remediationsApi from '@redhat-cloud-services/frontend-components-remediations/remediationsApi';
import ComplianceRemediationButton from './ComplianceRemediationButton';
import { CheckCircleIcon, ExclamationCircleIcon } from '@patternfly/react-icons';
import routerParams from '@redhat-cloud-services/frontend-components-utilities/files/RouterParams';
import { Ansible, Pagination, TableToolbar } from '@redhat-cloud-services/frontend-components';
import { Table, TableHeader, TableBody, sortable, SortByDirection } from '@patternfly/react-table';
import { Checkbox, Level, LevelItem, Stack, StackItem } from '@patternfly/react-core';
import { RowLoader } from '@redhat-cloud-services/frontend-components-utilities/files/helpers';
import flatMap from 'lodash/flatMap';
import './compliance.scss';

const COMPLIANT_COLUMN = 3;

class SystemRulesTable extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            columns: [
                { title: 'Rule', transforms: [ sortable ]},
                { title: 'Policy', transforms: [ sortable ]},
                { title: 'Severity', transforms: [ sortable ]},
                { title: 'Passed', transforms: [ sortable ]},
                { title: 'Remediation' }
            ],
            page: 1,
            itemsPerPage: 10,
            hidePassedChecked: false,
            rows: [],
            currentRows: [],
            refIds: {},
            profiles: {},
            sortBy: {}
        };

    }
    removeRefIdPrefix = (refId) => {
        return refId.split('xccdf_org.ssgproject.content_profile_')[1];
    }

    setInitialCurrentRows() {
        const { itemsPerPage } = this.state;
        const { hidePassed, profileRules } = this.props;
        const rowsRefIds = this.rulesToRows(profileRules);
        this.currentRows(1, itemsPerPage, rowsRefIds).then((currentRows) => {
            this.setState(() => (
                {
                    currentRows,
                    rows: rowsRefIds.rows,
                    profiles: rowsRefIds.profiles,
                    refIds: rowsRefIds.refIds
                }
            ));
            if (hidePassed) {
                this.hidePassed(true);
            }
        });
    }

    componentDidMount = () => {
        this.setInitialCurrentRows();
    }

    componentDidUpdate = (prevProps) => {
        if (this.props.profileRules !== prevProps.profileRules) {
            this.setInitialCurrentRows();
        }
    }

    changePage = (page, itemsPerPage) => {
        this.currentRows(page, itemsPerPage).then((currentRows) => {
            this.setState(() => (
                {
                    page,
                    itemsPerPage,
                    currentRows
                }
            ));
        });
    }

    setPage = (page) => {
        const { itemsPerPage } = this.state;
        this.changePage(page, itemsPerPage);
    }

    setPerPage = (itemsPerPage) => {
        const { page } = this.state;
        this.changePage(page, itemsPerPage);
    }

    isParent = (row) => {
        return row.hasOwnProperty('isOpen');
    }

    remediationAvailable = (remediationId) => {
        return remediationId ? <Ansible/> : <Ansible unsupported={ true } />;
    }

    currentRows = (page, itemsPerPage, rowsRefIds) => {
        const { rows, profiles, refIds } = (rowsRefIds) ? rowsRefIds : this.state;

        if (!rows.length) {
            // Avoid even making an empty request to the remediations API
            return Promise.resolve([]);
        }

        const firstIndex = (page - 1) * itemsPerPage * 2;
        const lastIndex = page * itemsPerPage * 2;
        const newRows = flatMap(rows.slice(firstIndex, lastIndex), ({ parent, ...row }) => ({
            ...row,
            ...((parent || parent === 0) ? parent > itemsPerPage ? { parent: parent % (itemsPerPage * 2) } : { parent } : {})
        }));

        const ruleIds = newRows.filter(row => row.hasOwnProperty('isOpen'))
        .map(({ cells }) => `ssg:rhel7|${this.removeRefIdPrefix(profiles[cells[0]])}|${refIds[cells[0]]}`);

        return window.insights.chrome.auth.getUser()
        .then(() => {
            return remediationsApi.getResolutionsBatch(ruleIds)
            .then(response => newRows.map(({ cells, ...row }) => ({
                ...row,
                cells: [
                    ...cells,
                    ...this.isParent(row, cells) ? [
                        {
                            title: this.remediationAvailable(
                                response[`ssg:rhel7|${this.removeRefIdPrefix(profiles[cells[0]])}|${refIds[cells[0]]}`]
                            )
                        }
                    ] : []
                ]
            })));
        });
    }

    selectAll = (rows, selected) => {
        return rows.map(row => (
            {
                ...row,
                ...this.isParent(row) ? { selected } : {}
            }
        ));
    }

    onSelect = (_event, selected, key) => {
        const { page, itemsPerPage } = this.state;
        let { currentRows, rows } = this.state;
        if (key === -1) {
            rows = this.selectAll(rows, selected);
            currentRows = this.selectAll(currentRows, selected);
        } else {
            // One rule was selected
            const index = ((page - 1) * itemsPerPage * 2) + Number(key);
            if (!currentRows[index].cells[4].title.props.unsupported) {
                rows[index].selected = selected;
                currentRows[key].selected = selected;
            }
        }

        this.setState({ rows, currentRows });
    }

    calculateParent = ({ profile }, { title, severity, compliant }) => ({
        isOpen: false,
        cells: [
            title,
            profile.name,
            severity,
            { title: (compliant ? <CheckCircleIcon className='ins-u-passed' /> :
                <ExclamationCircleIcon className='ins-u-failed' />) }
        ]
    })

    calculateChild = ({ description, rationale }, key) => ({
        parent: key * 2,
        cells: [{
            title: (
                <React.Fragment key={ key }>
                    <Stack id={ `rule-description-${key}` } gutter="md">
                        <StackItem><b>Description</b></StackItem>
                        <StackItem isFilled>{ description }</StackItem>
                    </Stack>
                    <br/>
                    <Stack id={ `rule-rationale-${key}` } gutter="md">
                        <StackItem><b>Rationale</b></StackItem>
                        <StackItem isFilled>{ rationale }</StackItem>
                    </Stack>
                </React.Fragment>
            ) }]
    })

    rulesToRows = (profileRules) => {
        const refIds = {};
        const profiles = {};
        const rows = flatMap(profileRules, (profileRule) => flatMap(profileRule.rules, (rule, key) => {
            profiles[rule.title] = profileRule.profile.refId;
            refIds[rule.title] = rule.ref_id;
            return [
                this.calculateParent(profileRule, rule),
                this.calculateChild(rule, key)
            ];
        }));
        return { rows, refIds, profiles };
    }

    onCollapse = (_event, rowKey, isOpen) => {
        const { rows, profiles, refIds } = this.state;
        const key = ((this.state.page - 1) * this.state.itemsPerPage * 2) + Number(rowKey);
        rows[key].isOpen = isOpen;
        this.currentRows(this.state.page, this.state.itemsPerPage, { rows, profiles, refIds }).then((currentRows) => {
            this.setState(() => ({ rows, currentRows }));
        });
    }

    selectedRules = () => {
        const { currentRows, profiles, refIds } = this.state;
        return currentRows.filter(row => row.selected && !row.cells[4].title.props.unsupported).map(row => ({
            // We want to match this response with a similar response from GraphQL
            /* eslint-disable camelcase */
            ref_id: refIds[row.cells[0]],
            profiles: [{ ref_id: profiles[row.cells[0]] }],
            /* eslint-enable camelcase */
            title: row.cells[0] // This is the rule title, the description is too long
        }));
    }

    // This takes both the row and its children (collapsible rows) and puts them into
    // one element. It is used only so that the rows can be compared.
    compressRows = (rows) => {
        const compressedRows = [];
        rows.forEach((row, i) => {
            if (row.hasOwnProperty('isOpen')) {
                compressedRows.push({ parent: row, child: rows[i + 1] });
            }
        });

        return compressedRows;
    }

    uncompressRows(compressedRows) {
        const originalRows = [];
        compressedRows.forEach((compressedRow, i) => {
            originalRows.push(compressedRow.parent);
            if (compressedRow.child) {
                let child = compressedRow.child;
                child.parent = i * 2;
                originalRows.push(child);
            }
        });
        return originalRows;
    }

    onSort = (_event, index, direction) => {
        // Original index is not the right column, as patternfly adds 1 because
        // of the 'collapsible' button and 1 because of the checkbox.
        let column = index - 2;
        const { refIds, rows, page, profiles, itemsPerPage } = this.state;
        const sortedRows = this.uncompressRows(
            this.compressRows(rows).sort(
                (a, b) => {
                    if (direction === SortByDirection.asc) {
                        if (column === COMPLIANT_COLUMN) {
                            return a.parent.cells[column].title.props.className === b.parent.cells[column].title.props.className ? 0 :
                                a.parent.cells[column].title.props.className < b.parent.cells[column].title.props.className ? 1 : -1;
                        } else {
                            return a.parent.cells[column].localeCompare(b.parent.cells[column]);
                        }

                    } else {
                        if (column === COMPLIANT_COLUMN) {
                            return a.parent.cells[column].title.props.className === b.parent.cells[column].title.props.className ? 0 :
                                a.parent.cells[column].title.props.className > b.parent.cells[column].title.props.className ? 1 : -1;
                        } else {
                            return -a.parent.cells[column].localeCompare(b.parent.cells[column]);
                        }
                    }
                }
            )
        );
        this.currentRows(page, itemsPerPage, { rows: sortedRows, profiles, refIds }).then((currentRows) => {
            this.setState(() => ({
                currentRows,
                sortBy: {
                    index,
                    direction
                },
                rows: sortedRows
            }));
        });
    }

    hidePassed = (checked) => {
        const { rows, originalRows, profiles, refIds, page, itemsPerPage } = this.state;
        if (checked) {
            const onlyPassedRows = [];
            rows.forEach((row, i) => {
                if (row.hasOwnProperty('isOpen') && row.cells[COMPLIANT_COLUMN].title.props.className === 'ins-u-failed') {
                    onlyPassedRows.push(row);
                    if (!rows[i + 1].hasOwnProperty('isOpen')) {
                        let child = rows[i + 1];
                        child.parent = onlyPassedRows.length - 1;
                        onlyPassedRows.push(child);
                    }
                }
            });

            this.currentRows(page, itemsPerPage, { rows: onlyPassedRows, profiles, refIds }).then((currentRows) => {
                this.setState(() => ({
                    currentRows,
                    originalRows: rows,
                    rows: onlyPassedRows,
                    hidePassedChecked: checked
                }));
            });
        } else {
            this.currentRows(page, itemsPerPage, { rows: originalRows, profiles, refIds }).then((currentRows) => {
                this.setState(() => ({
                    currentRows,
                    rows: originalRows,
                    hidePassedChecked: checked
                }));
            });
        }
    }

    render() {
        const { sortBy, hidePassedChecked, rows, currentRows, columns, page, itemsPerPage } = this.state;
        const { loading, profileRules } = this.props;
        const system = profileRules[0].system;
        if (loading) {
            return (
                <Table
                    cells={ columns }
                    rows={ [ ...Array(10) ].map(() => ({
                        cells: [{
                            title: <RowLoader />,
                            colSpan: 5
                        }]
                    })) }>
                    <TableHeader />
                    <TableBody />
                </Table>
            );
        } else {
            /* eslint-disable camelcase */
            return (
                <React.Fragment>
                    <TableToolbar>
                        <Level gutter='md'>
                            <LevelItem>
                                <Checkbox checked={ hidePassedChecked } onChange={ this.hidePassed } label={ 'Hide Passed Rules' } />
                            </LevelItem>
                            <LevelItem>
                                { rows.length / 2 } results
                            </LevelItem>
                            <LevelItem>
                                <ComplianceRemediationButton
                                    allSystems={ [{ id: system, rule_objects_failed: []}] }
                                    selectedRules={ this.selectedRules() } />
                            </LevelItem>
                        </Level>
                    </TableToolbar>
                    <Table
                        cells={ columns }
                        onCollapse={ this.onCollapse }
                        onSort={ this.onSort }
                        sortBy={ sortBy }
                        onSelect={ this.onSelect }
                        rows={ currentRows }>
                        <TableHeader />
                        <TableBody />
                    </Table>
                    <Pagination
                        numberOfItems={ rows.length / 2 }
                        onPerPageSelect={ this.setPerPage }
                        page={ page }
                        onSetPage={ this.setPage }
                        itemsPerPage={ itemsPerPage }
                    />
                </React.Fragment>
            );
            /* eslint-enable camelcase */
        }
    }
}

SystemRulesTable.propTypes = {
    profileRules: propTypes.array,
    loading: propTypes.bool,
    hidePassed: propTypes.bool
};

SystemRulesTable.defaultProps = {
    profileRules: [{ rules: []}]
};

export default routerParams(SystemRulesTable);
